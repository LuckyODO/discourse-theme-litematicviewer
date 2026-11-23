import assert from "node:assert/strict";
import test from "node:test";
import { ATLAS } from "../../renderer/generated/texture-atlas.mjs";
import { buildMesh } from "../../renderer/mesh.mjs";

// Explicit Minecraft partner locations, independent of the mesher's lookup.
const PARTNERS = {
  north: { left: [1, 0, 0], right: [-1, 0, 0] },
  east: { left: [0, 0, 1], right: [0, 0, -1] },
  south: { left: [-1, 0, 0], right: [1, 0, 0] },
  west: { left: [0, 0, -1], right: [0, 0, 1] },
};
const KINDS = [
  ["chest", "normal"],
  ["trapped_chest", "trapped"],
  ["copper_chest", "copper"],
  ["waxed_copper_chest", "copper"],
  ["waxed_oxidized_copper_chest", "copper_oxidized"],
];
const CHEST_TILES = Object.entries(ATLAS.tiles).filter(([name]) =>
  name.startsWith("entity/chest/")
);
const entry = (id, facing, type) => ({
  name: `minecraft:${id}`,
  properties: { facing, type, waterlogged: "false" },
});
const add = (a, b) => a.map((value, axis) => value + b[axis]);
const cell = (position, block) => ({
  position,
  size: [1, 1, 1],
  palette: [block],
  blocks: new Uint32Array([0]),
});

function scene(regions) {
  return {
    regions,
    bounds: {
      min: [0, 1, 2].map((axis) =>
        Math.min(...regions.map((region) => region.position[axis]))
      ),
      max: [0, 1, 2].map((axis) =>
        Math.max(
          ...regions.map((region) => region.position[axis] + region.size[axis])
        )
      ),
    },
  };
}

function tilesAt(mesh, schematic, position) {
  const origin = position.map(
    (value, axis) => value - schematic.bounds.min[axis]
  );
  const names = new Set();
  for (let face = 0; face < mesh.faceCount; face++) {
    const center = [0, 0, 0];
    let x = 0;
    let y = 0;
    for (let vertex = 0; vertex < 6; vertex++) {
      for (let axis = 0; axis < 3; axis++) {
        center[axis] += mesh.positions[face * 18 + vertex * 3 + axis] / 6;
      }
      x += (mesh.uvs[face * 12 + vertex * 2] * ATLAS.width) / 6;
      y += ((1 - mesh.uvs[face * 12 + vertex * 2 + 1]) * ATLAS.height) / 6;
    }
    if (
      !center.every(
        (value, axis) =>
          value >= origin[axis] - 1e-6 && value < origin[axis] + 1 - 1e-6
      )
    ) {
      continue;
    }
    const match = CHEST_TILES.find(
      ([, tile]) =>
        x >= tile.x &&
        x <= tile.x + tile.width &&
        y >= tile.y &&
        y <= tile.y + tile.height
    );
    assert.ok(match, "every chest surface must reference a chest texture tile");
    names.add(match[0]);
  }
  assert.ok(names.size > 0, "the requested chest has visible surfaces");
  return [...names].sort();
}

test("correct left/right chest partners retain double-chest textures across regions in all four directions", () => {
  const origin = [-9, 4, 7];
  for (const [id, texture] of KINDS) {
    for (const facing of Object.keys(PARTNERS)) {
      for (const half of ["left", "right"]) {
        const opposite = half === "left" ? "right" : "left";
        const partner = add(origin, PARTNERS[facing][half]);
        const schematic = scene([
          cell(origin, entry(id, facing, half)),
          cell(partner, entry(id, facing, opposite)),
        ]);
        const mesh = buildMesh(schematic);
        assert.equal(mesh.fallbackBlockCount, 0);
        assert.deepEqual(
          tilesAt(mesh, schematic, origin),
          [`entity/chest/${texture}_${half}`],
          `${id} ${facing} ${half}`
        );
        assert.deepEqual(
          tilesAt(mesh, schematic, partner),
          [`entity/chest/${texture}_${opposite}`],
          `${id} ${facing} partner`
        );
      }
    }
  }
});

test("isolated left/right chest states become complete single chests for every family and facing", () => {
  for (const [id, texture] of KINDS) {
    for (const facing of Object.keys(PARTNERS)) {
      for (const half of ["left", "right"]) {
        const origin = [4, 2, -3];
        const schematic = scene([cell(origin, entry(id, facing, half))]);
        const mesh = buildMesh(schematic);
        assert.deepEqual(
          tilesAt(mesh, schematic, origin),
          [`entity/chest/${texture}`],
          `${id} ${facing} ${half}`
        );
        assert.equal(mesh.fallbackBlockCount, 0);
      }
    }
  }
});

test("wrong offset, same half, different facing, different kind and air never form a pair", () => {
  const origin = [0, 0, 0];
  const cases = [
    ["wrong horizontal side", [-1, 0, 0], entry("chest", "north", "right")],
    ["wrong height", [1, 1, 0], entry("chest", "north", "right")],
    ["same type", [1, 0, 0], entry("chest", "north", "left")],
    ["different facing", [1, 0, 0], entry("chest", "east", "right")],
    ["different family", [1, 0, 0], entry("trapped_chest", "north", "right")],
    ["air", [1, 0, 0], { name: "minecraft:air" }],
  ];
  for (const [description, position, other] of cases) {
    const schematic = scene([
      cell(origin, entry("chest", "north", "left")),
      cell(position, other),
    ]);
    assert.deepEqual(
      tilesAt(buildMesh(schematic), schematic, origin),
      ["entity/chest/normal"],
      description
    );
  }
  const waxed = scene([
    cell(origin, entry("waxed_copper_chest", "north", "left")),
    cell([1, 0, 0], entry("copper_chest", "north", "right")),
  ]);
  const mesh = buildMesh(waxed);
  assert.deepEqual(tilesAt(mesh, waxed, origin), ["entity/chest/copper"]);
  assert.deepEqual(tilesAt(mesh, waxed, [1, 0, 0]), ["entity/chest/copper"]);
});

test("one palette entry can produce a paired chest and an orphan without cache contamination", () => {
  const position = [-2, 5, 9];
  const palette = [
    { name: "minecraft:air" },
    entry("chest", "north", "left"),
    entry("chest", "north", "right"),
  ];
  const schematic = scene([
    {
      position,
      size: [5, 1, 1],
      palette,
      blocks: new Uint32Array([1, 2, 0, 1, 0]),
    },
  ]);
  const mesh = buildMesh(schematic);
  assert.deepEqual(tilesAt(mesh, schematic, position), [
    "entity/chest/normal_left",
  ]);
  assert.deepEqual(tilesAt(mesh, schematic, add(position, [1, 0, 0])), [
    "entity/chest/normal_right",
  ]);
  assert.deepEqual(tilesAt(mesh, schematic, add(position, [3, 0, 0])), [
    "entity/chest/normal",
  ]);
  assert.equal(palette[1].properties.type, "left");
});

test("layer rebuilds keep connected and orphan appearances stable without mutating the source palette", () => {
  const left = entry("trapped_chest", "east", "left");
  const right = entry("trapped_chest", "east", "right");
  const schematic = scene([
    cell([3, 0, 4], left),
    cell([3, 0, 5], right),
    cell([3, 2, 4], left),
  ]);
  const all = buildMesh(schematic);
  const cut = buildMesh(schematic, 0);
  const restored = buildMesh(schematic);
  assert.deepEqual(tilesAt(all, schematic, [3, 0, 4]), [
    "entity/chest/trapped_left",
  ]);
  assert.deepEqual(tilesAt(cut, schematic, [3, 0, 4]), [
    "entity/chest/trapped_left",
  ]);
  assert.deepEqual(tilesAt(all, schematic, [3, 2, 4]), [
    "entity/chest/trapped",
  ]);
  assert.deepEqual(restored.positions, all.positions);
  assert.deepEqual(restored.uvs, all.uvs);
  assert.equal(left.properties.type, "left");
  assert.equal(right.properties.type, "right");
});
