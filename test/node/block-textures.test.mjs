import assert from "node:assert/strict";
import test from "node:test";
import { blockTextures } from "../../renderer/block-textures.mjs";
import { ATLAS } from "../../renderer/generated/texture-atlas.mjs";

const faces = (id, properties = {}) =>
  blockTextures({ name: `minecraft:${id}`, properties });

function localUV(face, a, b) {
  const tile = ATLAS.tiles[face.name];
  const [u0, u1, u2, v0, v1, v2] = face.uv;
  return [
    ((u0 * a + u1 * b + u2) * ATLAS.width - tile.x) / tile.width,
    ((1 - (v0 * a + v1 * b + v2)) * ATLAS.height - tile.y) / tile.height,
  ];
}

test("common building models select actual bundled vanilla texture tiles", () => {
  for (const [id, expected] of [
    ["stone", "stone"],
    ["stone_bricks", "stone_bricks"],
    ["bricks", "bricks"],
    ["stone_brick_stairs", "stone_bricks"],
    ["nether_brick_fence", "nether_bricks"],
    ["mossy_stone_brick_wall", "mossy_stone_bricks"],
    ["oak_slab", "oak_planks"],
    ["dark_oak_fence_gate", "dark_oak_planks"],
    ["bamboo_mosaic_stairs", "bamboo_mosaic"],
    ["waxed_oxidized_cut_copper_stairs", "oxidized_cut_copper"],
    ["blue_carpet", "blue_wool"],
    ["moss_carpet", "moss_block"],
    ["pale_moss_carpet", "pale_moss_carpet"],
    ["poplar_slab", "poplar_planks"],
    ["poplar_fence", "poplar_planks"],
    ["red_stained_glass_pane", "red_stained_glass"],
  ]) {
    for (const face of faces(id)) {
      assert.equal(face.name, expected, id);
      assert.equal(face.textured, true, id);
      assert.ok(ATLAS.tiles[face.name], id);
    }
  }
});

test("atlas projections preserve face orientation and top-origin pixel rectangles", () => {
  const stone = faces("stone");
  assert.deepEqual(localUV(stone[0], 0.25, 0.75), [0.75, 0.75]);
  assert.deepEqual(localUV(stone[1], 0.25, 0.75), [0.25, 0.75]);
  assert.deepEqual(localUV(stone[2], 0.25, 0.75), [0.25, 0.25]);
  assert.deepEqual(localUV(stone[3], 0.25, 0.75), [0.25, 0.75]);
  assert.deepEqual(localUV(stone[4], 0.25, 0.75), [0.75, 0.25]);
  assert.deepEqual(localUV(stone[5], 0.25, 0.75), [0.25, 0.25]);
  for (const face of stone) {
    for (const a of [0, 1]) {
      for (const b of [0, 1]) {
        assert.ok(
          localUV(face, a, b).every((value) => value >= 0 && value <= 1)
        );
      }
    }
  }
});

test("logs choose end grain by axis and bark UVs follow horizontal grain", () => {
  for (const [axis, coordinate] of [
    ["x", 0],
    ["y", 1],
    ["z", 2],
  ]) {
    const log = faces("oak_log", { axis });
    log.forEach((face, index) => {
      assert.equal(
        face.name,
        Math.floor(index / 2) === coordinate ? "oak_log_top" : "oak_log"
      );
    });
  }
  const x = faces("oak_log", { axis: "x" });
  const y = faces("oak_log", { axis: "y" });
  const z = faces("oak_log", { axis: "z" });
  assert.notEqual(localUV(x[5], 0, 0)[1], localUV(x[5], 1, 0)[1]);
  assert.equal(localUV(x[5], 0, 0)[1], localUV(x[5], 0, 1)[1]);
  assert.notEqual(localUV(y[5], 0, 0)[1], localUV(y[5], 0, 1)[1]);
  assert.notEqual(localUV(z[1], 0, 0)[1], localUV(z[1], 0, 1)[1]);
  assert.ok(
    faces("stripped_spruce_wood").every(
      (face) => face.name === "stripped_spruce_log"
    )
  );
  assert.equal(faces("warped_stem", { axis: "z" })[4].name, "warped_stem_top");
});

test("grass, pillars and oriented fronts select their correct face textures", () => {
  assert.deepEqual(
    faces("grass_block").map((face) => face.name),
    [
      "grass_block_side",
      "grass_block_side",
      "dirt",
      "grass_block_top",
      "grass_block_side",
      "grass_block_side",
    ]
  );
  const front = faces("furnace", { facing: "east", lit: "true" });
  assert.equal(front[1].name, "furnace_front_on");
  assert.equal(front[4].name, "furnace_side");
  assert.equal(front[3].name, "furnace_top");
  assert.equal(faces("smoker")[2].name, "smoker_bottom");
  const barrel = faces("barrel", { facing: "down", open: "true" });
  assert.equal(barrel[2].name, "barrel_top_open");
  assert.equal(barrel[3].name, "barrel_bottom");
  assert.equal(
    faces("quartz_pillar", { axis: "x" })[1].name,
    "quartz_pillar_top"
  );
  assert.equal(
    faces("quartz_pillar", { axis: "x" })[3].name,
    "quartz_pillar_side"
  );
  assert.equal(
    faces("oak_door", { facing: "east", half: "upper" })[0].name,
    "oak_door_top"
  );
  assert.equal(
    faces("oak_door", { facing: "east", half: "upper" })[4].name,
    "oak_planks"
  );
  assert.equal(
    faces("oak_door", { facing: "east", open: "true", hinge: "left" })[4].name,
    "oak_door_bottom"
  );
});

test("bundled 26.3 pillar and poplar textures never fall back on either end or sides", () => {
  for (const id of [
    "quartz_pillar",
    "purpur_pillar",
    "poplar_log",
    "stripped_poplar_log",
  ]) {
    for (const [axis, coordinate] of [
      ["x", 0],
      ["y", 1],
      ["z", 2],
    ]) {
      const textures = faces(id, { axis });
      textures.forEach((face, index) => {
        const expected =
          Math.floor(index / 2) === coordinate
            ? `${id}_top`
            : id.endsWith("pillar")
              ? `${id}_side`
              : id;
        assert.equal(face.name, expected, `${id} ${axis} face ${index}`);
        assert.equal(face.textured, true);
        assert.ok(ATLAS.tiles[expected]);
      });
    }
  }
});

test("textured colors stay neutral except for grayscale biome textures", () => {
  assert.ok(
    faces("bricks").every((face) => face.tint.every((value) => value === 1))
  );
  const grass = faces("grass_block");
  assert.ok(grass[3].tint[1] > grass[3].tint[0]);
  assert.deepEqual(grass[4].tint, [1, 1, 1]);
  const oak = faces("oak_leaves")[0];
  assert.ok(oak.tint[1] > oak.tint[0]);
  assert.ok(oak.cutout);
  assert.deepEqual(faces("cherry_leaves")[0].tint, [1, 1, 1]);
  for (const color of ["red", "orange", "yellow"]) {
    const leaf = faces(`${color}_poplar_leaves`)[0];
    assert.equal(leaf.textured, true);
    assert.deepEqual(leaf.tint, [1, 1, 1]);
  }
  assert.ok(faces("glass").every((face) => face.cutout));
  assert.ok(faces("stone").every((face) => !face.cutout));
});

test("unknown and unsupported multipart models use the white fallback tile", () => {
  for (const entry of [
    "example:stone",
    "minecraft:future_block",
    "minecraft:chest",
    "minecraft:red_bed",
    "minecraft:rail",
  ]) {
    const textures = blockTextures(entry);
    assert.ok(
      textures.every((face) => !face.textured && face.name === "__white"),
      entry
    );
  }
  const atlas = {
    width: 64,
    height: 32,
    tiles: {
      __white: { x: 2, y: 2, width: 1, height: 1 },
      stone: { x: 20, y: 4, width: 16, height: 16, cutout: false },
    },
  };
  const top = blockTextures("minecraft:stone", atlas)[3];
  assert.deepEqual(top.uv, [0.25, 0, 20 / 64, -0, -0.5, 1 - 4 / 32]);
});
