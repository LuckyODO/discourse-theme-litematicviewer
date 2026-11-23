import assert from "node:assert/strict";
import test from "node:test";
import { ATLAS } from "../../renderer/generated/texture-atlas.mjs";
import {
  buildMesh,
  MAX_MESH_FACES,
  MAX_MESH_MODELS,
} from "../../renderer/mesh.mjs";

function region({
  size = [1, 1, 1],
  position = [0, 0, 0],
  palette = [{ name: "minecraft:stone", properties: {} }],
  blocks,
} = {}) {
  return {
    size,
    position,
    palette,
    blocks: blocks || new Uint32Array(size[0] * size[1] * size[2]),
  };
}

function extent(geometry, axis) {
  const values = [];
  for (let index = axis; index < geometry.positions.length; index += 3) {
    values.push(geometry.positions[index]);
  }
  return [Math.min(...values), Math.max(...values)];
}

function area(mesh) {
  let total = 0;
  for (let index = 0; index < mesh.positions.length; index += 9) {
    const a = Array.from(mesh.positions.slice(index, index + 3));
    const b = Array.from(mesh.positions.slice(index + 3, index + 6)).map(
      (value, axis) => value - a[axis]
    );
    const c = Array.from(mesh.positions.slice(index + 6, index + 9)).map(
      (value, axis) => value - a[axis]
    );
    total +=
      Math.hypot(
        b[1] * c[2] - b[2] * c[1],
        b[2] * c[0] - b[0] * c[2],
        b[0] * c[1] - b[1] * c[0]
      ) / 2;
  }
  return total;
}

test("an isolated cube has six correctly wound faces and finite vertex colors", () => {
  const mesh = buildMesh({ regions: [region()] });
  assert.equal(mesh.faceCount, 6);
  assert.equal(mesh.positions.length, 108);
  assert.equal(mesh.positions.length, mesh.normals.length);
  assert.equal(mesh.positions.length, mesh.colors.length);
  assert.equal(mesh.uvs.length, mesh.faceCount * 12);
  assert.ok(
    mesh.uvs.every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1
    )
  );
  assert.equal(area(mesh), 6);
  assert.ok(
    mesh.colors.every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1
    )
  );
  for (let index = 0; index < mesh.positions.length; index += 9) {
    const a = mesh.positions.slice(index, index + 3);
    const b = mesh.positions
      .slice(index + 3, index + 6)
      .map((value, axis) => value - a[axis]);
    const c = mesh.positions
      .slice(index + 6, index + 9)
      .map((value, axis) => value - a[axis]);
    const cross = [
      b[1] * c[2] - b[2] * c[1],
      b[2] * c[0] - b[0] * c[2],
      b[0] * c[1] - b[1] * c[0],
    ];
    assert.ok(
      cross.reduce(
        (sum, value, axis) => sum + value * mesh.normals[index + axis],
        0
      ) > 0
    );
  }
});

test("adjacent cubes remove interior faces within and across regions", () => {
  assert.equal(
    buildMesh({ regions: [region({ size: [2, 1, 1] })] }).faceCount,
    10
  );
  assert.equal(
    buildMesh({ regions: [region(), region({ position: [1, 0, 0] })] })
      .faceCount,
    10
  );
  assert.equal(
    buildMesh({ regions: [region({ size: [3, 3, 3] })] }).faceCount,
    54
  );
});

test("layer cuts include the selected Y and expose a new top surface", () => {
  const scene = { regions: [region({ size: [1, 2, 1] })] };
  const mesh = buildMesh(scene, 0);
  assert.equal(mesh.faceCount, 6);
  assert.deepEqual(extent(mesh, 1), [0, 1]);
  assert.equal(buildMesh(scene, -1).faceCount, 0);
});

test("negative region positions are rebased against the scene bounds", () => {
  const mesh = buildMesh({
    regions: [region({ position: [-8, -3, -2] })],
    bounds: { min: [-8, -3, -2], max: [-7, -2, -1] },
  });
  assert.deepEqual(extent(mesh, 0), [0, 1]);
  assert.deepEqual(extent(mesh, 1), [0, 1]);
  assert.deepEqual(extent(mesh, 2), [0, 1]);
});

test("large offsets preserve half-block precision while cuts use world Y", () => {
  const min = [2000000000, -2000000000, 1000000000];
  const scene = {
    regions: [
      region({
        position: min,
        palette: [
          { name: "minecraft:stone_slab", properties: { type: "top" } },
        ],
      }),
    ],
    bounds: { min, max: min.map((value) => value + 1) },
  };
  const mesh = buildMesh(scene, min[1]);
  assert.deepEqual(extent(mesh, 0), [0, 1]);
  assert.deepEqual(extent(mesh, 1), [0.5, 1]);
  assert.equal(buildMesh(scene, min[1] - 1).faceCount, 0);
});

test("air is identified by name rather than palette position", () => {
  const mesh = buildMesh({
    regions: [
      region({
        size: [3, 1, 1],
        palette: [
          { name: "minecraft:stone" },
          { name: "minecraft:cave_air" },
          { name: "minecraft:void_air" },
        ],
        blocks: new Uint32Array([0, 1, 2]),
      }),
    ],
  });
  assert.equal(mesh.faceCount, 6);
});

test("unused entries in large palettes are never compiled into model objects", () => {
  const unused = {
    get name() {
      throw new Error("Unused palette entry was read");
    },
  };
  const palette = new Array(65536).fill(unused);
  palette[0] = { name: "minecraft:stone" };
  const mesh = buildMesh({ regions: [region({ palette })] });
  assert.equal(mesh.faceCount, 6);
});

test("a dense scene cannot bypass the distinct-model memory budget", () => {
  const count = 8300;
  const palette = Array.from({ length: count }, (_, index) => ({
    name: `test:block_${index}`,
  }));
  const blocks = Uint32Array.from({ length: count }, (_, index) => index);
  assert.equal(MAX_MESH_MODELS, 8192);
  assert.throws(
    () =>
      buildMesh({ regions: [region({ size: [83, 1, 100], palette, blocks })] }),
    (error) => error.category === "too_complex"
  );
});

test("duplicate palette states across regions share the same model budget", () => {
  const regions = Array.from({ length: 130 }, (_region, regionIndex) =>
    region({
      size: [1, 1, 65],
      position: [regionIndex * 2, 0, 0],
      palette: Array.from({ length: 65 }, (_, index) => ({
        name: `test:block_${index}`,
        properties:
          regionIndex % 2
            ? { half: "bottom", facing: "north" }
            : { facing: "north", half: "bottom" },
      })),
      blocks: Uint32Array.from({ length: 65 }, (_, index) => index),
    })
  );
  const mesh = buildMesh({ regions });
  assert.equal(mesh.faceCount, 130 * (65 * 4 + 2));
});

test("slabs respect top, bottom and double block states", () => {
  for (const [type, expected, expectedArea] of [
    ["bottom", [0, 0.5], 4],
    ["top", [0.5, 1], 4],
    ["double", [0, 1], 6],
  ]) {
    const mesh = buildMesh({
      regions: [
        region({
          palette: [{ name: "minecraft:oak_slab", properties: { type } }],
        }),
      ],
    });
    assert.deepEqual(extent(mesh, 1), expected);
    assert.equal(area(mesh), expectedArea);
  }
});

test("stair cuboids form a surface union without internal coplanar faces", () => {
  for (const facing of ["north", "east", "south", "west"]) {
    for (const half of ["bottom", "top"]) {
      const mesh = buildMesh({
        regions: [
          region({
            palette: [
              { name: "minecraft:stone_stairs", properties: { facing, half } },
            ],
          }),
        ],
      });
      assert.equal(area(mesh), 5.5);
      assert.deepEqual(extent(mesh, 1), [0, 1]);
    }
  }
});

test("a cube and adjacent half slab clip only the covered face area", () => {
  const mesh = buildMesh({
    regions: [
      region({
        size: [2, 1, 1],
        palette: [
          { name: "minecraft:stone" },
          { name: "minecraft:stone_slab", properties: { type: "bottom" } },
        ],
        blocks: new Uint32Array([0, 1]),
      }),
    ],
  });
  assert.equal(area(mesh), 9);
});

test("connected fences, panes, open doors and flat rails have non-cube geometry", () => {
  for (const entry of [
    {
      name: "minecraft:oak_fence",
      properties: { north: "true", east: "true" },
    },
    {
      name: "minecraft:glass_pane",
      properties: { north: "true", south: "true" },
    },
    {
      name: "minecraft:oak_door",
      properties: { open: "true", facing: "north", hinge: "left" },
    },
    { name: "minecraft:rail", properties: { shape: "east_west" } },
  ]) {
    const mesh = buildMesh({ regions: [region({ palette: [entry] })] });
    assert.ok(mesh.faceCount > 0);
    assert.notEqual(area(mesh), 6);
  }
});

test("logs distinguish end grain axis and unknown blocks have stable distinct colors", () => {
  const meshFor = (entry) =>
    buildMesh({ regions: [region({ palette: [entry] })] });
  assert.notDeepEqual(
    meshFor({ name: "minecraft:oak_log", properties: { axis: "x" } }).uvs,
    meshFor({ name: "minecraft:oak_log", properties: { axis: "y" } }).uvs
  );
  const one = meshFor({ name: "example:machine_one" });
  assert.deepEqual(one.colors, meshFor({ name: "example:machine_one" }).colors);
  assert.notDeepEqual(
    one.colors,
    meshFor({ name: "example:machine_two" }).colors
  );
});

test("textured bricks keep neutral vertex colors and modded air remains visible", () => {
  const stone = buildMesh({
    regions: [region({ palette: [{ name: "minecraft:stone_bricks" }] })],
  });
  const brick = buildMesh({
    regions: [region({ palette: [{ name: "minecraft:bricks" }] })],
  });
  assert.deepEqual(stone.colors, brick.colors);
  assert.notDeepEqual(stone.uvs, brick.uvs);
  for (let index = 0; index < stone.colors.length; index += 3) {
    assert.equal(stone.colors[index], stone.colors[index + 1]);
    assert.equal(stone.colors[index + 1], stone.colors[index + 2]);
  }
  assert.equal(
    buildMesh({ regions: [region({ palette: [{ name: "example:air" }] })] })
      .faceCount,
    6
  );
});

test("partially occluded faces crop their original block UVs without stretching", () => {
  const mesh = buildMesh({
    regions: [
      region({
        size: [2, 1, 1],
        palette: [
          { name: "minecraft:stone" },
          { name: "minecraft:stone_slab" },
        ],
        blocks: new Uint32Array([0, 1]),
      }),
    ],
  });
  const tile = ATLAS.tiles.stone;
  const pixelYs = [];
  for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++) {
    const offset = vertex * 3;
    if (mesh.positions[offset] === 1 && mesh.normals[offset] === 1) {
      const y = mesh.positions[offset + 1];
      const v = mesh.uvs[vertex * 2 + 1];
      const localV = ((1 - v) * ATLAS.height - tile.y) / tile.height;
      assert.ok(Math.abs(localV - (1 - y)) < 1e-5);
      pixelYs.push(localV);
    }
  }
  assert.equal(pixelYs.length, 6);
  assert.equal(Math.min(...pixelYs), 0);
  assert.equal(Math.max(...pixelYs), 0.5);
});

test("glass and leaves preserve opaque neighbor surfaces behind their cutouts", () => {
  for (const cutout of ["glass", "oak_leaves"]) {
    const mesh = buildMesh({
      regions: [
        region({
          size: [2, 1, 1],
          palette: [
            { name: "minecraft:stone" },
            { name: `minecraft:${cutout}` },
          ],
          blocks: new Uint32Array([0, 1]),
        }),
      ],
    });
    assert.equal(mesh.faceCount, 11);
    assert.equal(area(mesh), 11);
    assert.ok(
      Array.from(
        { length: mesh.positions.length / 3 },
        (_, vertex) => vertex
      ).some(
        (vertex) =>
          mesh.positions[vertex * 3] === 1 && mesh.normals[vertex * 3] === 1
      )
    );
  }
  assert.equal(
    buildMesh({
      regions: [
        region({ size: [2, 1, 1], palette: [{ name: "minecraft:glass" }] }),
      ],
    }).faceCount,
    12
  );
});

test("sparse complex models stop at a bounded face budget", () => {
  const edge = 42;
  const blocks = new Uint32Array(edge ** 3);
  for (let y = 0; y < edge; y++) {
    for (let z = 0; z < edge; z++) {
      for (let x = 0; x < edge; x++) {
        blocks[x + edge * (z + edge * y)] = (x + y + z) % 2;
      }
    }
  }
  assert.equal(MAX_MESH_FACES, 200000);
  assert.throws(
    () =>
      buildMesh({
        regions: [
          region({
            size: [edge, edge, edge],
            palette: [{ name: "minecraft:stone" }, { name: "minecraft:air" }],
            blocks,
          }),
        ],
      }),
    (error) => error.category === "too_complex"
  );
});
