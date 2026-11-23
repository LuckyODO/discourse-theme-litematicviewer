import assert from "node:assert/strict";
import test from "node:test";
import { ATLAS } from "../../renderer/generated/texture-atlas.mjs";
import {
  normalizeSpecialData,
  resolveSpecialModel,
  specialModelKey,
} from "../../renderer/special-models.mjs";
import { resolveVanillaModel } from "../../renderer/vanilla-models.mjs";

const block = (name, properties = {}) => ({
  name: `minecraft:${name}`,
  properties,
});
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const bounds = (model) => {
  const points = model.faces.flatMap((face) =>
    Array.from({ length: 4 }, (_value, index) =>
      face.vertices.slice(index * 3, index * 3 + 3)
    )
  );
  return {
    min: [0, 1, 2].map((axis) =>
      Math.min(...points.map((point) => point[axis]))
    ),
    max: [0, 1, 2].map((axis) =>
      Math.max(...points.map((point) => point[axis]))
    ),
  };
};

test("single, double, trapped, ender and copper chests retain their actual textures and locks", () => {
  for (const [name, texture] of [
    ["chest", "normal"],
    ["trapped_chest", "trapped"],
    ["ender_chest", "ender"],
    ["waxed_exposed_copper_chest", "copper_exposed"],
  ]) {
    const model = resolveSpecialModel(block(name, { facing: "south" }));
    assert.ok(model.supported);
    assert.equal(model.faces.length, 16);
    assert.ok(
      model.faces.every((face) => face.texture === `entity/chest/${texture}`)
    );
    close(bounds(model).max[1], 14 / 16);
    close(bounds(model).max[2], 1);
  }
  const left = resolveSpecialModel(
    block("chest", { type: "left", facing: "south" })
  );
  const right = resolveSpecialModel(
    block("chest", { type: "right", facing: "south" })
  );
  assert.equal(left.faces.length, 13);
  assert.equal(right.faces.length, 13);
  close(bounds(left).min[0], 0);
  close(bounds(right).max[0], 1);
  assert.ok(left.faces.every((face) => face.texture.endsWith("normal_left")));
  assert.ok(right.faces.every((face) => face.texture.endsWith("normal_right")));
  const north = resolveSpecialModel(block("chest", { facing: "north" }));
  close(bounds(north).min[2], 0);
});

test("modern and legacy banner appearance data normalize for batching and preserve layer order", () => {
  const entry = block("red_banner");
  const modern = {
    patterns: [
      { color: "white", pattern: "minecraft:stripe_center" },
      { color: "blue", pattern: { asset_id: "minecraft:border" } },
    ],
  };
  const legacy = {
    Patterns: [
      { Color: 0, Pattern: "cs" },
      { Color: 11, Pattern: "bo" },
    ],
    x: 456,
    Items: [{ irrelevant: true }],
  };
  assert.equal(specialModelKey(entry, modern), specialModelKey(entry, legacy));
  const model = resolveSpecialModel(entry, modern);
  assert.equal(model.faces.length, 30);
  assert.equal(model, resolveSpecialModel(entry, legacy));
  const baseFront = model.faces.find(
    (face) => face.texture.endsWith("banner_base") && face.normal[2] > 0.9
  );
  const stripeFront = model.faces.find(
    (face) => face.texture.endsWith("stripe_center") && face.normal[2] > 0.9
  );
  const borderFront = model.faces.find(
    (face) => face.texture.endsWith("border") && face.normal[2] > 0.9
  );
  assert.ok(baseFront.vertices[2] < stripeFront.vertices[2]);
  assert.ok(stripeFront.vertices[2] < borderFront.vertices[2]);
  assert.notDeepEqual(baseFront.tint, stripeFront.tint);
  assert.notDeepEqual(stripeFront.tint, borderFront.tint);
  assert.throws(
    () =>
      resolveSpecialModel(entry, {
        patterns: Array.from({ length: 17 }, () => ({
          pattern: "base",
          color: "red",
        })),
      }),
    (error) => error.category === "too_complex"
  );
});

test("standing banners keep their pole and wall banners hang below the attachment block", () => {
  const standing = resolveSpecialModel(
    block("white_banner", { rotation: "0" })
  );
  const wall = resolveSpecialModel(
    block("red_wall_banner", { facing: "north" })
  );
  assert.equal(standing.faces.length, 18);
  assert.equal(wall.faces.length, 12);
  close(bounds(standing).min[1], 0);
  close(bounds(standing).max[1], 29.33333333333333 / 16);
  close(bounds(wall).min[1], -0.8);
  assert.ok(bounds(wall).min[2] > 0.8);
  const rotated = resolveSpecialModel(block("white_banner", { rotation: "4" }));
  assert.notDeepEqual(standing.faces[0].normal, rotated.faces[0].normal);
});

test("closed shulker boxes form opaque cubes in every attachment direction", () => {
  for (const facing of ["up", "down", "north", "south", "west", "east"]) {
    const model = resolveSpecialModel(block("blue_shulker_box", { facing }));
    assert.ok(model.supported);
    assert.equal(model.faces.length, 10);
    const extent = bounds(model);
    extent.min.forEach((value) => close(value, 0));
    extent.max.forEach((value) => close(value, 1));
    assert.deepEqual(
      model.occlusion,
      Array.from({ length: 6 }, () => [[0, 0, 1, 1]])
    );
  }
});

test("decorated pots assign the four saved sherds to distinct sides", () => {
  const entry = block("decorated_pot", { facing: "south" });
  const data = {
    sherds: [
      "minecraft:angler_pottery_sherd",
      "minecraft:archer_pottery_sherd",
      "minecraft:arms_up_pottery_sherd",
      "minecraft:brick",
    ],
  };
  assert.equal(
    specialModelKey(entry, data),
    specialModelKey(entry, { Sherds: data.sherds })
  );
  const model = resolveSpecialModel(entry, data);
  assert.ok(model.supported);
  const textures = model.faces.slice(0, 4).map((face) => face.texture);
  assert.deepEqual(
    textures,
    [
      "angler_pottery_pattern",
      "archer_pottery_pattern",
      "arms_up_pottery_pattern",
      "decorated_pot_side",
    ].map((name) => `entity/decorated_pot/${name}`)
  );
  close(bounds(model).max[1], 19.9 / 16);
  assert.deepEqual(
    normalizeSpecialData(entry).sherds,
    Array(4).fill("decorated_pot_side")
  );
});

test("vanilla heads use bundled skins and wall attachment, including dragon and piglin parts", () => {
  for (const name of [
    "skeleton_skull",
    "wither_skeleton_skull",
    "zombie_head",
    "creeper_head",
    "player_head",
    "dragon_head",
    "piglin_head",
  ]) {
    const model = resolveSpecialModel(block(name));
    assert.ok(model.supported, name);
    assert.ok(model.faces.length >= 6, name);
    assert.ok(model.faces.every((face) => face.texture.startsWith("entity/")));
  }
  assert.equal(resolveSpecialModel(block("piglin_head")).faces.length, 36);
  assert.equal(resolveSpecialModel(block("dragon_head")).faces.length, 42);
  close(
    bounds(
      resolveSpecialModel(block("skeleton_wall_skull", { facing: "north" }))
    ).max[2],
    1
  );
  assert.equal(
    resolveSpecialModel({ name: "example:custom_head", properties: {} }),
    null
  );
});

test("beds and signs reuse complete JSON models, while bells add the missing bell body", () => {
  for (const name of [
    "red_bed",
    "oak_sign",
    "oak_wall_sign",
    "oak_hanging_sign",
    "oak_wall_hanging_sign",
  ]) {
    const entry = block(name);
    assert.equal(resolveSpecialModel(entry), resolveVanillaModel(entry), name);
  }
  const entry = block("bell", { facing: "north", attachment: "floor" });
  assert.equal(
    resolveSpecialModel(entry).faces.length,
    resolveVanillaModel(entry).faces.length + 12
  );
  assert.equal(resolveSpecialModel(block("conduit")).faces.length, 6);
  assert.equal(specialModelKey(block("stone"), { patterns: ["ignored"] }), "");
  assert.equal(resolveSpecialModel(block("stone")), null);
});

test("all special quads have finite geometry, unit normals and UVs inside their original texture", () => {
  const samples = [
    "chest",
    "blue_banner",
    "green_wall_banner",
    "white_shulker_box",
    "decorated_pot",
    "bell",
    "conduit",
    "piglin_head",
    "dragon_head",
    "skeleton_skull",
    "player_head",
    "enchanting_table",
    "end_portal",
    "end_gateway",
  ];
  for (const name of samples) {
    for (const face of resolveSpecialModel(block(name)).faces) {
      assert.ok(
        [...face.vertices, ...face.uvs, ...face.normal].every(Number.isFinite),
        name
      );
      close(Math.hypot(...face.normal), 1);
      const tile = ATLAS.tiles[face.texture];
      face.uvs.forEach((value, index) => {
        const pixel =
          index % 2
            ? (1 - value) * ATLAS.height - tile.y
            : value * ATLAS.width - tile.x;
        assert.ok(
          pixel >= -1e-6 &&
            pixel <= (index % 2 ? tile.height : tile.width) + 1e-6,
          `${name}/${face.texture}: ${pixel}`
        );
      });
    }
  }
});

test("enchanting tables include the open book and portals retain their static visible surfaces", () => {
  const entry = block("enchanting_table");
  const model = resolveSpecialModel(entry);
  const base = resolveVanillaModel(entry);
  assert.ok(model.supported);
  assert.equal(model.faces.length, base.faces.length + 42);
  assert.ok(
    model.faces.some(
      (face) => face.texture === "entity/enchantment/enchanting_table_book"
    )
  );
  assert.ok(bounds(model).max[1] > bounds(base).max[1]);
  const portal = resolveSpecialModel(block("end_portal"));
  const gateway = resolveSpecialModel(block("end_gateway"));
  assert.equal(portal.faces.length, 2);
  assert.equal(gateway.faces.length, 6);
  close(bounds(portal).min[1], 6 / 16);
  close(bounds(portal).max[1], 12 / 16);
  assert.ok(portal.faces.every((face) => face.shade === false));
});
