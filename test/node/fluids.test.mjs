import assert from "node:assert/strict";
import test from "node:test";
import { createFluidFaces, fluidState } from "../../renderer/fluids.mjs";
import { ATLAS } from "../../renderer/generated/texture-atlas.mjs";
import { buildMesh } from "../../renderer/mesh.mjs";

const entry = (level = 0, type = "water") => ({
  name: `minecraft:${type}`,
  properties: { level: `${level}` },
});
const cell = (level = 0, type = "water") => ({
  fluid: fluidState(entry(level, type)),
  solid: false,
});
const key = (x, y, z) => `${x},${y},${z}`;
const samples = (entries) => (x, y, z) => entries.get(key(x, y, z)) || null;
const fluidTop = (faces) => faces.find((face) => face.cullface === 3);
const points = (face) =>
  Array.from({ length: 4 }, (_value, index) =>
    face.vertices.slice(index * 3, index * 3 + 3)
  );
function region(position, palette, size = [1, 1, 1], blocks) {
  return {
    position,
    palette,
    size,
    blocks: blocks || new Uint32Array(size[0] * size[1] * size[2]),
  };
}

test("source, flowing, falling and waterlogged palette states retain distinct heights", () => {
  assert.equal(fluidState(entry(0)).height, 8 / 9);
  assert.equal(fluidState(entry(3)).height, 5 / 9);
  assert.equal(fluidState(entry(7)).height, 1 / 9);
  assert.equal(fluidState(entry(12)).height, 8 / 9);
  assert.equal(fluidState(entry(0, "lava")).type, "lava");
  assert.equal(
    fluidState({
      name: "minecraft:oak_slab",
      properties: { waterlogged: "true" },
    }).waterlogged,
    true
  );
  assert.equal(fluidState({ name: "example:water" }), null);
  assert.equal(fluidState({ name: "minecraft:bubble_column" }).type, "water");
});

test("bubble columns share water surfaces without a special-renderer fallback cube", () => {
  const mesh = buildMesh({
    regions: [
      region(
        [0, 0, 0],
        [
          { name: "minecraft:bubble_column", properties: { drag: "true" } },
          entry(),
        ],
        [2, 1, 1],
        new Uint32Array([0, 1])
      ),
    ],
  });
  assert.equal(mesh.opaqueFaceCount, 0);
  assert.equal(mesh.translucentFaceCount, 10);
  assert.equal(mesh.fallbackBlockCount, 0);
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    assert.equal(
      mesh.positions[offset] === 1 && Math.abs(mesh.normals[offset]) === 1,
      false
    );
  }
});

test("fluid corners average nearby levels and exactly share heights across block borders", () => {
  const world = new Map([
    [key(0, 0, 0), cell(0)],
    [key(1, 0, 0), cell(5)],
  ]);
  const left = createFluidFaces(cell(0).fluid, samples(world));
  const right = createFluidFaces(cell(5).fluid, (x, y, z) =>
    samples(world)(x + 1, y, z)
  );
  assert.equal(
    left.some((face) => face.cullface === 1),
    false
  );
  assert.equal(
    right.some((face) => face.cullface === 0),
    false
  );
  const leftEdge = points(fluidTop(left))
    .filter(([x]) => x === 1)
    .sort((a, b) => a[2] - b[2]);
  const rightEdge = points(fluidTop(right))
    .filter(([x]) => x === 0)
    .sort((a, b) => a[2] - b[2]);
  assert.deepEqual(
    leftEdge.map((point) => point[1]),
    rightEdge.map((point) => point[1])
  );
  const heights = points(fluidTop(right)).map((point) => point[1]);
  assert.ok(Math.max(...heights) - Math.min(...heights) > 0.1);
  assert.ok(heights.every((height) => height > 0 && height <= 1));
});

test("source surfaces use still UVs while sloped and falling surfaces use flow tiles", () => {
  const single = new Map([[key(0, 0, 0), cell()]]);
  const still = fluidTop(createFluidFaces(cell().fluid, samples(single)));
  const flowWorld = new Map([
    [key(0, 0, 0), cell()],
    [key(1, 0, 0), cell(6)],
  ]);
  const flow = fluidTop(createFluidFaces(cell().fluid, samples(flowWorld)));
  const fallingWorld = new Map([[key(0, 0, 0), cell(8)]]);
  const falling = fluidTop(
    createFluidFaces(cell(8).fluid, samples(fallingWorld))
  );
  for (const [face, name] of [
    [still, "water_still"],
    [flow, "water_flow"],
    [falling, "water_flow"],
  ]) {
    const tile = ATLAS.tiles[name];
    for (let vertex = 0; vertex < 4; vertex++) {
      const x = face.uvs[vertex * 2] * ATLAS.width;
      const y = (1 - face.uvs[vertex * 2 + 1]) * ATLAS.height;
      assert.ok(x >= tile.x && x <= tile.x + tile.width);
      assert.ok(y >= tile.y && y <= tile.y + tile.height);
    }
  }
});

test("fluid above fills the column and enclosed fluid emits no interior surfaces", () => {
  const world = new Map([
    [key(0, 0, 0), cell()],
    [key(0, 1, 0), cell()],
    [key(0, -1, 0), cell()],
  ]);
  const faces = createFluidFaces(cell().fluid, samples(world));
  assert.equal(
    faces.some((face) => face.cullface === 3 || face.cullface === 2),
    false
  );
  assert.ok(
    faces.every(
      (face) => Math.max(...points(face).map((point) => point[1])) === 1
    )
  );
  assert.deepEqual(
    createFluidFaces(cell().fluid, () => cell()),
    []
  );
});

test("glass and stone aquarium walls hold the same water level without treating slabs as full walls", () => {
  const surfaceHeights = (wall) => {
    const blocks = new Uint32Array(9);
    blocks[4] = 1;
    const mesh = buildMesh({
      regions: [region([0, 0, 0], [wall, entry()], [3, 1, 3], blocks)],
    });
    const heights = [];
    for (let offset = 0; offset < mesh.positions.length; offset += 3) {
      const [x, y, z] = mesh.positions.slice(offset, offset + 3);
      if (
        x >= 1 &&
        x <= 2 &&
        z >= 1 &&
        z <= 2 &&
        y > 0.5 &&
        y < 1 &&
        mesh.normals[offset + 1] > 0.9
      ) {
        heights.push(y);
      }
    }
    return heights;
  };
  const stone = surfaceHeights({ name: "minecraft:stone" });
  assert.equal(stone.length, 6);
  assert.ok(stone.every((height) => Math.abs(height - 8 / 9) < 1e-6));
  assert.deepEqual(surfaceHeights({ name: "minecraft:glass" }), stone);
  assert.deepEqual(surfaceHeights({ name: "minecraft:oak_leaves" }), stone);
  const slab = surfaceHeights({
    name: "minecraft:stone_slab",
    properties: { type: "bottom" },
  });
  assert.equal(slab.length, 6);
  assert.ok(slab.every((height) => height < stone[0]));
});

test("cross-region fluid seams match and internal sides stay hidden after mesh expansion", () => {
  const mesh = buildMesh({
    regions: [region([-1, 0, 0], [entry(0)]), region([0, 0, 0], [entry(5)])],
    bounds: { min: [-1, 0, 0], max: [1, 1, 1] },
  });
  assert.equal(mesh.opaqueFaceCount, 0);
  assert.equal(mesh.translucentFaceCount, 10);
  const borderHeights = [];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    if (mesh.positions[index] === 1 && mesh.normals[index + 1] > 0) {
      borderHeights.push(mesh.positions[index + 1]);
    }
    assert.equal(
      mesh.positions[index] === 1 && Math.abs(mesh.normals[index]) === 1,
      false
    );
  }
  assert.ok(borderHeights.length >= 4);
  assert.ok(borderHeights.every((value) => value === borderHeights[0]));
  assert.ok(mesh.normals.every(Number.isFinite));
});

test("waterlogged slabs retain their model and add clipped translucent fluid", () => {
  const dry = {
    name: "minecraft:oak_slab",
    properties: { type: "bottom", waterlogged: "false" },
  };
  const wet = {
    name: "minecraft:oak_slab",
    properties: { type: "bottom", waterlogged: "true" },
  };
  const a = buildMesh({ regions: [region([0, 0, 0], [dry])] });
  const b = buildMesh({ regions: [region([0, 0, 0], [wet])] });
  assert.equal(b.opaqueFaceCount, a.faceCount);
  assert.deepEqual(b.positions.slice(0, a.positions.length), a.positions);
  assert.ok(b.translucentFaceCount > 0);
  assert.equal(b.fallbackBlockCount, 0);
  const surface = b.positions.slice(b.opaqueFaceCount * 18);
  for (let index = 1; index < surface.length; index += 3) {
    assert.ok(surface[index] >= 0.5 - 1e-6);
  }
});

test("waterlogged top slabs retain their solid planes and clip exposed water sides below the slab", () => {
  const dry = {
    name: "minecraft:oak_slab",
    properties: { type: "top", waterlogged: "false" },
  };
  const wet = {
    name: "minecraft:oak_slab",
    properties: { type: "top", waterlogged: "true" },
  };
  const a = buildMesh({ regions: [region([0, 0, 0], [dry])] });
  const b = buildMesh({ regions: [region([0, 0, 0], [wet])] });
  assert.deepEqual(b.positions.slice(0, a.positions.length), a.positions);
  assert.ok(b.translucentFaceCount > 0);
  let sideVertices = 0;
  for (
    let offset = b.opaqueFaceCount * 18;
    offset < b.positions.length;
    offset += 3
  ) {
    if (Math.abs(b.normals[offset + 1]) < 1e-6) {
      assert.ok(b.positions[offset + 1] <= 0.5 + 1e-6);
      sideVertices++;
    }
  }
  assert.ok(sideVertices > 0);
});

test("fluid cuts expose a new top and lava remains in the opaque batch", () => {
  const scene = { regions: [region([0, 0, 0], [entry()], [1, 2, 1])] };
  const cut = buildMesh(scene, 0);
  assert.equal(cut.faceCount, 6);
  assert.equal(cut.translucentFaceCount, 6);
  assert.equal(buildMesh(scene, -1).faceCount, 0);
  assert.ok(
    cut.positions
      .filter((_value, index) => index % 3 === 1)
      .every((value) => value < 1)
  );
  const lava = buildMesh({ regions: [region([0, 0, 0], [entry(0, "lava")])] });
  assert.equal(lava.opaqueFaceCount, 6);
  assert.equal(lava.translucentFaceCount, 0);
  assert.equal(lava.fallbackBlockCount, 0);
});

test("sloped fluid triangle normals match their emitted geometry", () => {
  const mesh = buildMesh({
    regions: [
      region(
        [0, 0, 0],
        [entry(0), entry(6)],
        [2, 1, 1],
        new Uint32Array([0, 1])
      ),
    ],
  });
  for (let index = 0; index < mesh.positions.length; index += 9) {
    const a = [0, 1, 2].map(
      (axis) => mesh.positions[index + 3 + axis] - mesh.positions[index + axis]
    );
    const b = [0, 1, 2].map(
      (axis) => mesh.positions[index + 6 + axis] - mesh.positions[index + axis]
    );
    const cross = [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const length = Math.hypot(...cross);
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(
        Math.abs(cross[axis] / length - mesh.normals[index + axis]) < 1e-5
      );
    }
  }
});
