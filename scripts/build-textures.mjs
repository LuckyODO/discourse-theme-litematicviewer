import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PADDING = 2;
const MAX_DIMENSION = 2048;
const compareNames = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export async function readTextureSources({ root = ROOT, version } = {}) {
  if (!/^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/.test(version)) {
    throw new Error("Invalid texture source version.");
  }
  const bytes = await readFile(
    path.join(root, "texture-source", `${version}.json`)
  );
  if (bytes.byteLength > 64 * 1024 * 1024) {
    throw new Error("Texture source container exceeds the build limit.");
  }
  const container = JSON.parse(bytes.toString("utf8"));
  if (
    container?.format !== "litematic-texture-source-v1" ||
    container.version !== version ||
    !container.files ||
    typeof container.files !== "object" ||
    Array.isArray(container.files)
  ) {
    throw new Error("Invalid texture source container.");
  }
  const names = Object.keys(container.files).sort(compareNames);
  if (names.length === 0 || names.length > 16_384) {
    throw new Error("Texture source file count exceeds the build limit.");
  }
  const contents = new Map();
  for (const filename of names) {
    if (
      !/^(?:[a-z0-9][a-z0-9_.-]*\/)*[a-z0-9][a-z0-9_.-]*\.png(?:\.mcmeta)?$/.test(
        filename
      )
    ) {
      throw new Error(`Invalid texture source filename: ${filename}`);
    }
    const encoded = container.files[filename];
    if (typeof encoded !== "string" || encoded.length > 24 * 1024 * 1024) {
      throw new Error(`Invalid texture source bytes: ${filename}`);
    }
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.toString("base64") !== encoded) {
      throw new Error(`Invalid texture source base64: ${filename}`);
    }
    contents.set(filename, decoded);
  }
  return contents;
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid texture animation ${field}.`);
  }
  return value;
}

export function textureFrame(image, metadata = null) {
  const animation = metadata?.animation;
  let width = image.width;
  let height = image.height;
  let index = 0;
  if (animation !== undefined) {
    if (
      !animation ||
      typeof animation !== "object" ||
      Array.isArray(animation)
    ) {
      throw new Error("Invalid texture animation metadata.");
    }
    // Java's default frame is square; specifying one dimension leaves the
    // other at the source image size. Explicit frame lists choose playback order.
    if (animation.width !== undefined) {
      width = positiveInteger(animation.width, "width");
      height =
        animation.height === undefined
          ? image.height
          : positiveInteger(animation.height, "height");
    } else if (animation.height !== undefined) {
      width = image.width;
      height = positiveInteger(animation.height, "height");
    } else {
      width = height = Math.min(image.width, image.height);
    }
    if (animation.frames !== undefined) {
      if (!Array.isArray(animation.frames)) {
        throw new Error("Invalid texture animation frames.");
      }
      if (animation.frames.length) {
        const first = animation.frames[0];
        index = typeof first === "number" ? first : first?.index;
      }
    }
  }
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    width > MAX_DIMENSION - PADDING * 2 ||
    height > MAX_DIMENSION - PADDING * 2 ||
    image.width % width !== 0 ||
    image.height % height !== 0 ||
    index >= (image.width / width) * (image.height / height)
  ) {
    throw new Error("Texture animation frame is outside its image.");
  }
  const columns = image.width / width;
  return {
    x: (index % columns) * width,
    y: Math.floor(index / columns) * height,
    width,
    height,
    index,
    animated: animation !== undefined,
  };
}

function extractPixels(image, frame) {
  const pixels = Buffer.alloc(frame.width * frame.height * 4);
  let cutout = false;
  let translucent = false;
  for (let row = 0; row < frame.height; row++) {
    const start = ((frame.y + row) * image.width + frame.x) * 4;
    image.data.copy(
      pixels,
      row * frame.width * 4,
      start,
      start + frame.width * 4
    );
  }
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 255) {
      cutout = true;
    }
    if (pixels[i] > 0 && pixels[i] < 255) {
      translucent = true;
    }
  }
  return { pixels, cutout, translucent };
}

function packFrames(frames, width) {
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  const rectangles = [];
  for (const frame of frames) {
    const paddedWidth = frame.width + PADDING * 2;
    const paddedHeight = frame.height + PADDING * 2;
    if (paddedWidth > width) {
      return null;
    }
    if (x + paddedWidth > width) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    rectangles.push({ frame, x: x + PADDING, y: y + PADDING });
    x += paddedWidth;
    rowHeight = Math.max(rowHeight, paddedHeight);
  }
  const height = 2 ** Math.ceil(Math.log2(Math.max(1, y + rowHeight)));
  return height <= MAX_DIMENSION ? { width, height, rectangles } : null;
}

function drawFrame(atlas, rectangle) {
  const { frame, x, y } = rectangle;
  // Duplicate the edge pixels, including alpha, into a two-pixel gutter.
  for (let row = -PADDING; row < frame.height + PADDING; row++) {
    const sourceY = Math.max(0, Math.min(frame.height - 1, row));
    for (let column = -PADDING; column < frame.width + PADDING; column++) {
      const sourceX = Math.max(0, Math.min(frame.width - 1, column));
      const sourceOffset = (sourceY * frame.width + sourceX) * 4;
      const targetOffset = ((y + row) * atlas.width + x + column) * 4;
      frame.pixels.copy(
        atlas.data,
        targetOffset,
        sourceOffset,
        sourceOffset + 4
      );
    }
  }
}

export async function buildTextureAtlas({ root = ROOT } = {}) {
  const provenance = JSON.parse(
    await readFile(path.join(root, "texture-source/source.json"), "utf8")
  );
  if (!/^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/.test(provenance.version)) {
    throw new Error("Invalid texture source version.");
  }
  const contents = await readTextureSources({
    root,
    version: provenance.version,
  });
  const files = [...contents.keys()];
  const sourceHash = createHash("sha256");
  for (const filename of files) {
    const bytes = contents.get(filename);
    sourceHash.update(filename);
    sourceHash.update("\0");
    sourceHash.update(bytes);
    sourceHash.update("\0");
  }
  const sourceDigest = sourceHash.digest("hex");
  if (
    provenance.sourceFilesSha256 &&
    provenance.sourceFilesSha256 !== sourceDigest
  ) {
    throw new Error(
      "Texture source bytes do not match their recorded provenance hash."
    );
  }
  const pngFiles = files.filter((filename) => filename.endsWith(".png"));
  if (pngFiles.length === 0 || pngFiles.length > 8192) {
    throw new Error(
      "Texture source must contain between 1 and 8192 PNG files."
    );
  }
  const frames = [];
  for (const filename of pngFiles) {
    const bytes = contents.get(filename);
    if (
      bytes.length < 24 ||
      bytes.length > 16 * 1024 * 1024 ||
      bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 16_777_216
    ) {
      throw new Error(`Texture image exceeds the build limits: ${filename}`);
    }
    const image = PNG.sync.read(bytes, { checkCRC: true });
    const metadataBytes = contents.get(`${filename}.mcmeta`);
    const metadata = metadataBytes
      ? JSON.parse(metadataBytes.toString("utf8"))
      : null;
    let frame;
    try {
      frame = textureFrame(image, metadata);
    } catch (error) {
      throw new Error(`${filename}: ${error.message}`, { cause: error });
    }
    frames.push({
      key: filename.slice(0, -4),
      width: frame.width,
      height: frame.height,
      animated: frame.animated,
      frameIndex: frame.index,
      ...extractPixels(image, frame),
    });
  }
  frames.push({
    key: "__white",
    width: 1,
    height: 1,
    animated: false,
    frameIndex: 0,
    cutout: false,
    translucent: false,
    pixels: Buffer.from([255, 255, 255, 255]),
  });
  frames.sort(
    (a, b) =>
      b.height - a.height || b.width - a.width || compareNames(a.key, b.key)
  );
  // Entity sheets keep their original non-square dimensions. Pick the smallest
  // allocation, retaining a narrow atlas on ties instead of forcing 2048².
  const packed = [1024, MAX_DIMENSION]
    .map((width) => packFrames(frames, width))
    .filter(Boolean)
    .sort(
      (a, b) => a.width * a.height - b.width * b.height || a.width - b.width
    )[0];
  if (!packed) {
    throw new Error("Texture atlas exceeds the 2048 × 2048 build limit.");
  }
  const atlas = new PNG({ width: packed.width, height: packed.height });
  const tiles = Object.create(null);
  for (const rectangle of packed.rectangles) {
    drawFrame(atlas, rectangle);
    const { frame, x, y } = rectangle;
    tiles[frame.key] = {
      x,
      y,
      width: frame.width,
      height: frame.height,
      cutout: frame.cutout,
      translucent: frame.translucent,
      animated: frame.animated,
      frameIndex: frame.frameIndex,
    };
  }
  const metadata = {
    width: packed.width,
    height: packed.height,
    version: provenance.version,
    padding: PADDING,
    sourceSha256: sourceDigest,
    tiles: Object.fromEntries(
      Object.keys(tiles)
        .sort(compareNames)
        .map((name) => [name, tiles[name]])
    ),
  };
  const png = PNG.sync.write(atlas, {
    bitDepth: 8,
    colorType: 6,
    inputColorType: 6,
    filterType: 4,
    deflateLevel: 9,
    deflateStrategy: 0,
    deflateChunkSize: 32768,
  });
  const banner =
    "// Generated by scripts/build-textures.mjs. Texture copyright: texture-source/LICENSE.md.\n";
  return {
    metadata,
    png,
    outputs: new Map([
      ["assets/litematic-atlas.png", png],
      [
        "renderer/generated/texture-atlas.mjs",
        Buffer.from(
          `${banner}export const ATLAS = ${JSON.stringify(metadata)};\n`
        ),
      ],
      [
        "renderer/generated/atlas-image.mjs",
        Buffer.from(
          `${banner}export const ATLAS_IMAGE_BASE64 = ${JSON.stringify(png.toString("base64"))};\n` +
            `export const ATLAS_SIZE = ${JSON.stringify([packed.width, packed.height])};\n` +
            `export const TEXTURE_VERSION = ${JSON.stringify(provenance.version)};\n`
        ),
      ],
    ]),
  };
}

export async function buildTextures({ check = false } = {}) {
  const { metadata, png, outputs } = await buildTextureAtlas();
  for (const [relative, bytes] of outputs) {
    const filename = path.join(ROOT, relative);
    if (check) {
      const existing = await readFile(filename).catch(() => null);
      if (!existing?.equals(bytes)) {
        throw new Error(
          `${relative} is stale. Run node scripts/build-textures.mjs.`
        );
      }
    } else {
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, bytes);
    }
  }
  process.stdout.write(
    `${check ? "Verified" : "Built"} Minecraft Java ${metadata.version} atlas: ` +
      `${Object.keys(metadata.tiles).length - 1} textures, ` +
      `${metadata.width} × ${metadata.height}, ${png.byteLength} PNG bytes.\n`
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await buildTextures({ check: process.argv.slice(2).includes("--check") });
}
