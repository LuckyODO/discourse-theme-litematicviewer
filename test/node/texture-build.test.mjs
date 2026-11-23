import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

test("selected entity sheets preserve the original client bytes and full native dimensions", async () => {
  const { png, metadata } = await builtAtlas();
  const image = PNG.sync.read(png);
  const sources = await readTextureSources({ version: "26.3" });
  // Fingerprints were taken directly from the SHA-1-verified official client,
  // independently of the source container and atlas builder.
  const selected = [
    [
      "entity/chest/normal",
      64,
      64,
      "ab478534503430192b224ea4d5e1e87b6820198925bb7a7b4bd32f2a8a55c801",
    ],
    [
      "entity/banner/stripe_center",
      64,
      64,
      "4bf8dab0f57cd3d7d4818170289306388d8b68f1d5e075d5fa2f8973ffe65105",
    ],
    [
      "entity/conduit/base",
      32,
      16,
      "52c0370563e72ae9251c3ee28c9a4a02ea193dd961f54f68de13475bdcbb3fe6",
    ],
    [
      "entity/enderdragon/dragon",
      256,
      256,
      "6133c12916bb6e4bfdc35389d52e79763d934bae827de90d66fdce2199f9d2f9",
    ],
    [
      "entity/skeleton/skeleton",
      64,
      32,
      "854dd39acb1d8852db3b9e5d3d2bdc032070e37f421b53661ff48d0c1ddf290a",
    ],
    [
      "entity/enchantment/enchanting_table_book",
      64,
      32,
      "8ea11fb9590b0d6e7858ad20adcc196c832af4466601764d6e290d611b0959a0",
    ],
    [
      "entity/end_portal/end_portal",
      256,
      256,
      "af82f34eea41a02dbb2824425fe9606f6cc629a94a5434395ed2a7cbd608d143",
    ],
    [
      "environment/end_sky",
      128,
      128,
      "4e3ac7408ad60efc9be391172f09436a1bfe2e0c278dab24665d47e7ff75f61e",
    ],
  ];
  for (const [name, width, height, sha256] of selected) {
    const bytes = sources.get(`${name}.png`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), sha256);
    const source = PNG.sync.read(bytes);
    const tile = metadata.tiles[name];
    assert.equal(tile.width, width);
    assert.equal(tile.height, height);
    assert.equal(tile.animated, false);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        assert.deepEqual(
          pixel(image, tile.x + x, tile.y + y),
          pixel(source, x, y),
          `${name}: pixel ${x},${y}`
        );
      }
    }
    assert.deepEqual(pixel(image, tile.x - 2, tile.y - 2), pixel(source, 0, 0));
    assert.deepEqual(
      pixel(image, tile.x + width + 1, tile.y + height + 1),
      pixel(source, width - 1, height - 1)
    );
  }
});

test("entity pattern alpha and namespaced texture coverage remain available within the atlas memory budget", async () => {
  const { metadata } = await builtAtlas();
  assert.ok(metadata.width * metadata.height * 4 <= 8 * 1024 * 1024);
  for (const name of [
    "entity/chest/normal_left",
    "entity/chest/trapped_right",
    "entity/chest/ender",
    "entity/chest/copper_oxidized_left",
    "entity/banner/banner_base",
    "entity/banner/base",
    "entity/banner/stripe_center",
    "entity/banner/creeper",
    "entity/banner/flow",
    "entity/shulker/shulker",
    "entity/shulker/shulker_red",
    "entity/decorated_pot/decorated_pot_base",
    "entity/decorated_pot/heart_pottery_pattern",
    "entity/bell/bell_body",
    "entity/conduit/closed_eye",
    "entity/player/wide/steve",
    "entity/skeleton/wither_skeleton",
    "entity/zombie/zombie",
    "entity/piglin/piglin",
    "oak_sign",
    "oak_hanging_sign",
    "red_bed_head_up",
  ]) {
    assert.ok(metadata.tiles[name], name);
  }
  const pattern = metadata.tiles["entity/banner/stripe_center"];
  assert.equal(pattern.cutout, true);
  assert.equal(pattern.translucent, true);
  assert.equal(metadata.tiles["entity/chest/normal"].translucent, false);
  assert.equal(metadata.tiles["entity/conduit/wind"].animated, true);
  const provenance = JSON.parse(
    await readFile(
      new URL("../../texture-source/source.json", import.meta.url),
      "utf8"
    )
  );
  assert.equal(metadata.sourceSha256, provenance.sourceFilesSha256);
  assert.equal(provenance.sourceContainer, "26.3.json");
});
