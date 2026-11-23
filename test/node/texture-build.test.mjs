import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PNG } from "pngjs";
import {
  ATLAS_IMAGE_BASE64,
  ATLAS_SIZE,
  TEXTURE_VERSION,
} from "../../renderer/generated/atlas-image.mjs";
import { ATLAS } from "../../renderer/generated/texture-atlas.mjs";
import {
  buildTextureAtlas,
  readTextureSources,
  textureFrame,
} from "../../scripts/build-textures.mjs";

let buildPromise;
function builtAtlas() {
  buildPromise ??= buildTextureAtlas();
  return buildPromise;
}

function pixel(image, x, y) {
  const offset = (y * image.width + x) * 4;
  return image.data.subarray(offset, offset + 4);
}

test("animation uses the first listed frame, including object entries and nonzero indices", () => {
  const image = { width: 16, height: 64 };
  assert.deepEqual(
    textureFrame(image, {
      animation: { frames: [{ index: 2, time: 4 }, 0, 1] },
    }),
    { x: 0, y: 32, width: 16, height: 16, index: 2, animated: true }
  );
  assert.deepEqual(textureFrame(image, { animation: { frames: [3, 0] } }), {
    x: 0,
    y: 48,
    width: 16,
    height: 16,
    index: 3,
    animated: true,
  });
});

test("explicit animation dimensions select a frame from a two-dimensional sheet", () => {
  const image = { width: 32, height: 64 };
  assert.deepEqual(
    textureFrame(image, {
      animation: { width: 16, height: 32, frames: [3] },
    }),
    { x: 16, y: 32, width: 16, height: 32, index: 3, animated: true }
  );
  assert.deepEqual(
    textureFrame(image, { animation: { width: 16, frames: [1] } }),
    { x: 16, y: 0, width: 16, height: 64, index: 1, animated: true }
  );
  assert.deepEqual(
    textureFrame(image, { animation: { height: 16, frames: [2] } }),
    { x: 0, y: 32, width: 32, height: 16, index: 2, animated: true }
  );
});

test("animation rejects out-of-range frames and incompatible frame dimensions", () => {
  for (const animation of [
    { frames: [2] },
    { frames: [-1] },
    { frames: [0.5] },
    { frames: [{ time: 4 }] },
    { width: 15 },
    { height: 0 },
  ]) {
    assert.throws(() => textureFrame({ width: 16, height: 32 }, { animation }));
  }
});

test("rebuilding reproduces the stored PNG, embedded image and generated tile coordinates", async () => {
  const { png, metadata } = await builtAtlas();
  const stored = await readFile(
    new URL("../../assets/litematic-atlas.png", import.meta.url)
  );
  assert.ok(png.equals(stored), "committed PNG must match its source textures");
  assert.ok(
    png.equals(Buffer.from(ATLAS_IMAGE_BASE64, "base64")),
    "viewer image must match the standalone PNG"
  );
  const image = PNG.sync.read(png);
  assert.deepEqual(ATLAS_SIZE, [image.width, image.height]);
  assert.deepEqual(metadata, ATLAS);
  assert.equal(metadata.version, TEXTURE_VERSION);
  assert.equal(metadata.padding, 2);
  for (const tile of Object.values(metadata.tiles)) {
    assert.ok(tile.x >= 2 && tile.y >= 2);
    assert.ok(tile.x + tile.width + 2 <= image.width);
    assert.ok(tile.y + tile.height + 2 <= image.height);
  }
});

test("stone and water preserve source pixels, native size and duplicated two-pixel edges", async () => {
  const { png, metadata } = await builtAtlas();
  const image = PNG.sync.read(png);
  const sources = await readTextureSources({ version: "26.3" });
  for (const [name, size, animated] of [
    ["stone", 16, false],
    ["water_still", 16, true],
    ["water_flow", 32, true],
  ]) {
    const source = PNG.sync.read(sources.get(`${name}.png`));
    const tile = metadata.tiles[name];
    assert.equal(tile.width, size);
    assert.equal(tile.height, size);
    assert.equal(tile.animated, animated);
    assert.equal(tile.frameIndex, 0);
    // These known sources start at frame zero. Check interior and both gutter
    // rings directly against the source, independently of the packing helper.
    for (const [x, y, sourceX, sourceY] of [
      [0, 0, 0, 0],
      [size - 1, size - 1, size - 1, size - 1],
      [size / 2, size / 2, size / 2, size / 2],
      [-2, -2, 0, 0],
      [-1, size / 2, 0, size / 2],
      [size, size / 2, size - 1, size / 2],
      [size + 1, size + 1, size - 1, size - 1],
      [size / 2, -2, size / 2, 0],
      [size / 2, size + 1, size / 2, size - 1],
    ]) {
      assert.deepEqual(
        pixel(image, tile.x + x, tile.y + y),
        pixel(source, sourceX, sourceY),
        `${name}: pixel ${x},${y}`
      );
    }
  }
  const white = metadata.tiles.__white;
  assert.equal(white.cutout, false);
  assert.deepEqual(
    pixel(image, white.x, white.y),
    Buffer.from([255, 255, 255, 255])
  );
});
