import assert from "node:assert/strict";
import test from "node:test";
import { ATLAS } from "../../renderer/generated/texture-atlas.mjs";
import {
  createVanillaModelResolver,
  modelConditionMatches,
  resolveVanillaModel,
  vanillaModelSeedPeriod,
} from "../../renderer/vanilla-models.mjs";
import { compileModelSources } from "../../scripts/build-models.mjs";

const close = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) =>
    assert.ok(
      Math.abs(value - expected[index]) < 1e-7,
      `${value} != ${expected[index]}`
    )
  );
};
const entry = (name, properties = {}) => ({
  name: `minecraft:${name}`,
  properties,
});

function fixture(element, variants = { "": { model: "block/fixture" } }) {
  const files = new Map([
    [
      "models/block/fixture.json",
      Buffer.from(
        JSON.stringify({
          textures: { all: "block/stone" },
          elements: [element],
        })
      ),
    ],
    ["blockstates/fixture.json", Buffer.from(JSON.stringify({ variants }))],
  ]);
  const atlas = {
    width: 16,
    height: 16,
    tiles: {
      stone: {
        x: 0,
        y: 0,
        width: 16,
        height: 16,
        cutout: false,
        translucent: false,
      },
    },
  };
  return createVanillaModelResolver(compileModelSources(files), atlas);
}

test("vanilla state variants select correct slab, door, bed and multipart fence geometry", () => {
  const bottom = resolveVanillaModel(entry("oak_slab", { type: "bottom" }));
  const top = resolveVanillaModel(entry("oak_slab", { type: "top" }));
  assert.ok(bottom.supported && top.supported);
  assert.equal(
    Math.max(
      ...bottom.faces.flatMap((face) =>
        face.vertices.filter((_v, index) => index % 3 === 1)
      )
    ),
    0.5
  );
  assert.equal(
    Math.min(
      ...top.faces.flatMap((face) =>
        face.vertices.filter((_v, index) => index % 3 === 1)
      )
    ),
    0.5
  );
  const fence = resolveVanillaModel(entry("oak_fence"));
  const joinedFence = resolveVanillaModel(
    entry("oak_fence", { north: "true", east: "true" })
  );
  assert.ok(joinedFence.faces.length > fence.faces.length);
  const closed = resolveVanillaModel(
    entry("oak_door", {
      facing: "east",
      half: "lower",
      hinge: "left",
      open: "false",
    })
  );
  const opened = resolveVanillaModel(
    entry("oak_door", {
      facing: "east",
      half: "lower",
      hinge: "left",
      open: "true",
    })
  );
  assert.notDeepEqual(closed.faces[0].vertices, opened.faces[0].vertices);
  for (const part of ["head", "foot"]) {
    const bed = resolveVanillaModel(
      entry("red_bed", { facing: "north", part })
    );
    assert.ok(bed.supported && bed.faces.length > 6);
  }
});

test("multipart predicates implement nested OR, AND, alternatives and negation", () => {
  const condition = {
    AND: [
      { OR: [{ north: "side|up" }, { east: "side" }] },
      { powered: "!true" },
    ],
  };
  assert.equal(
    modelConditionMatches(condition, { north: "up", powered: "false" }),
    true
  );
  assert.equal(
    modelConditionMatches(condition, {
      north: "none",
      east: "side",
      powered: "false",
    }),
    true
  );
  assert.equal(
    modelConditionMatches(condition, { north: "up", powered: "true" }),
    false
  );
  assert.equal(
    modelConditionMatches(condition, { north: "none", east: "none" }),
    false
  );
  const dot = resolveVanillaModel(
    entry("redstone_wire", {
      north: "none",
      south: "none",
      east: "none",
      west: "none",
    })
  );
  const rising = resolveVanillaModel(
    entry("redstone_wire", {
      north: "up",
      south: "none",
      east: "none",
      west: "none",
    })
  );
  assert.ok(dot.supported && rising.supported);
  assert.ok(rising.faces.some((face) => Math.abs(face.normal[1]) < 0.1));
});

test("element rotation and rescale preserve CCW normals and exact diagonal geometry", () => {
  const resolve = fixture({
    from: [0, 0, 8],
    to: [16, 16, 8],
    rotation: { axis: "y", angle: 45, origin: [8, 8, 8], rescale: true },
    faces: { south: { texture: "#all" } },
  });
  const face = resolve(entry("fixture")).faces[0];
  close(face.vertices, [0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0]);
  close(face.normal, [Math.SQRT1_2, 0, Math.SQRT1_2]);
  assert.equal(face.cullface, -1);
});

test("blockstate rotations rotate cullface while UV lock preserves world texture orientation", () => {
  const resolve = fixture(
    {
      from: [0, 0, 0],
      to: [16, 16, 16],
      faces: {
        north: { texture: "#all", cullface: "north" },
        up: { texture: "#all" },
      },
    },
    {
      "locked=false": { model: "block/fixture", y: 90 },
      "locked=true": { model: "block/fixture", y: 90, uvlock: true },
    }
  );
  const free = resolve(entry("fixture", { locked: "false" }));
  const locked = resolve(entry("fixture", { locked: "true" }));
  assert.equal(free.faces[0].cullface, 1);
  close(free.faces[0].normal, [1, 0, 0]);
  assert.deepEqual(free.faces[1].vertices, locked.faces[1].vertices);
  assert.notDeepEqual(free.faces[1].uvs, locked.faces[1].uvs);
  const face = locked.faces[1];
  for (let vertex = 0; vertex < 4; vertex++) {
    close(face.uvs.slice(vertex * 2, vertex * 2 + 2), [
      face.vertices[vertex * 3],
      1 - face.vertices[vertex * 3 + 2],
    ]);
  }
});

test("multi-axis element rotations apply X before Y before Z", () => {
  const resolve = fixture({
    from: [0, 0, 0],
    to: [16, 16, 16],
    rotation: { origin: [8, 8, 8], x: 90, y: 90 },
    faces: { south: { texture: "#all" } },
  });
  const face = resolve(entry("fixture")).faces[0];
  close(face.vertices.slice(0, 3), [1, 0, 1]);
  close(face.normal, [0, -1, 0]);
});

test("default UVs crop slabs, explicit UV rotation rotates texture corners", () => {
  const resolve = fixture({
    from: [0, 0, 0],
    to: [16, 8, 16],
    faces: {
      south: { texture: "#all" },
      north: { texture: "#all", uv: [2, 4, 10, 12], rotation: 90 },
    },
  });
  const result = resolve(entry("fixture"));
  close(result.faces[0].uvs, [0, 0.5, 0, 0, 1, 0, 1, 0.5]);
  close(result.faces[1].uvs, [
    2 / 16,
    4 / 16,
    10 / 16,
    4 / 16,
    10 / 16,
    12 / 16,
    2 / 16,
    12 / 16,
  ]);
});

test("vanilla glass uses translucent pass and tinted cutouts never occlude neighbours", () => {
  for (const id of ["glass", "white_stained_glass", "glass_pane", "ice"]) {
    const model = resolveVanillaModel(entry(id));
    assert.ok(model.supported);
    assert.ok(model.faces.every((face) => face.layer === "translucent"));
    assert.ok(model.occlusion.every((rectangles) => rectangles.length === 0));
  }
  const grass = resolveVanillaModel(entry("grass_block", { snowy: "false" }));
  const overlay = grass.faces.find(
    (face) => face.texture === "grass_block_side_overlay"
  );
  assert.ok(overlay.cutout);
  assert.notDeepEqual(overlay.tint, [1, 1, 1]);
  const stone = resolveVanillaModel(entry("stone"));
  assert.deepEqual(
    stone.occlusion,
    Array.from({ length: 6 }, () => [[0, 0, 1, 1]])
  );
  const tile = ATLAS.tiles.stone;
  assert.ok(
    stone.faces.every((face) =>
      face.uvs.every((uv, index) =>
        index % 2
          ? uv >= 1 - (tile.y + tile.height) / ATLAS.height &&
            uv <= 1 - tile.y / ATLAS.height
          : uv >= tile.x / ATLAS.width &&
            uv <= (tile.x + tile.width) / ATLAS.width
      )
    )
  );
});

test("special renderers remain explicit fallbacks and unknown names cannot access object prototypes", () => {
  assert.equal(resolveVanillaModel(entry("chest")).reason, "special_renderer");
  assert.equal(resolveVanillaModel(entry("chest")).supported, false);
  assert.equal(
    resolveVanillaModel({ name: "example:custom_block", properties: {} }),
    null
  );
  assert.equal(resolveVanillaModel(entry("constructor")), null);
  assert.equal(resolveVanillaModel(entry("__proto__")), null);
  const invisible = resolveVanillaModel(
    entry("pitcher_crop", { age: "1", half: "upper" })
  );
  assert.ok(invisible.supported);
  assert.equal(invisible.faces.length, 0);
  assert.ok(resolveVanillaModel(entry("heavy_core")).supported);
});

test("invisible world markers stay empty without suppressing special renderers", () => {
  for (const name of [
    "air",
    "cave_air",
    "void_air",
    "barrier",
    "light",
    "structure_void",
  ]) {
    const model = resolveVanillaModel(entry(name));
    assert.equal(model.supported, true, name);
    assert.deepEqual(model.faces, [], name);
    assert.ok(model.occlusion.every((rectangles) => rectangles.length === 0));
  }
  for (const name of ["end_portal", "end_gateway", "chest"]) {
    const model = resolveVanillaModel(entry(name));
    assert.equal(model.supported, false, name);
    assert.equal(model.reason, "special_renderer", name);
  }
});

test("coordinate seeds preserve vanilla variant periods and weighted frequencies", () => {
  for (const name of ["stone", "dirt"]) {
    assert.equal(vanillaModelSeedPeriod(entry(name)), 4);
    const variants = Array.from({ length: 4 }, (_value, seed) =>
      resolveVanillaModel(entry(name), seed)
    );
    assert.equal(new Set(variants).size, 4);
    assert.equal(resolveVanillaModel(entry(name), 4), variants[0]);
  }
  assert.equal(
    vanillaModelSeedPeriod(entry("oak_slab", { type: "bottom" })),
    1
  );
  const resolve = fixture(
    {
      from: [0, 0, 0],
      to: [16, 16, 16],
      faces: { north: { texture: "#all" } },
    },
    {
      "": [
        { model: "block/fixture", weight: 1 },
        { model: "block/fixture", y: 90, weight: 3 },
      ],
    }
  );
  assert.equal(resolve.seedPeriod(entry("fixture")), 4);
  const directions = Array.from(
    { length: 4 },
    (_value, seed) => resolve(entry("fixture"), seed).faces[0].normal
  );
  assert.equal(directions.filter((normal) => normal[0] > 0.99).length, 3);
  assert.equal(directions.filter((normal) => normal[2] < -0.99).length, 1);
});

test("multipart variant periods use the exact LCM and bound excessive combinations", () => {
  const data = {
    states: {
      fixture: {
        multipart: [
          {
            apply: [
              { model: 0, weight: 1 },
              { model: 0, weight: 2, y: 90 },
            ],
          },
          { apply: [{ model: 0 }, { model: 0, y: 180 }] },
        ],
      },
      excessive: {
        multipart: [
          {
            apply: [
              { model: 0, weight: 4092 },
              { model: 0, y: 90 },
            ],
          },
          {
            apply: [
              { model: 0, weight: 4090 },
              { model: 0, y: 90 },
            ],
          },
        ],
      },
    },
    models: [],
    geometries: [],
  };
  const resolve = createVanillaModelResolver(data);
  assert.equal(resolve.seedPeriod(entry("fixture")), 6);
  assert.throws(
    () => resolve.seedPeriod(entry("excessive")),
    (error) => error.category === "too_complex"
  );
});
