import { encodeLitematicFixture } from "./litematic-fixture.mjs";

export const MODEL_SHOWCASE_EXPECTED = {
  blockCount: 541,
  dimensions: [21, 5, 17],
};

// A synthetic scene for actual vanilla-model and transparency browser checks.
// Every state has its normal blockstate properties; no mesh is mocked here.
export function createModelShowcaseFixture() {
  const size = { x: 21, y: 5, z: 17 };
  const palette = [{ name: "air" }];
  const paletteIndices = new Map();
  const blocks = new Array(size.x * size.y * size.z).fill(0);
  const put = (x, y, z, name, properties = {}) => {
    const key = `${name}:${JSON.stringify(properties)}`;
    if (!paletteIndices.has(key)) {
      paletteIndices.set(key, palette.length);
      palette.push({ name, properties });
    }
    blocks[x + size.x * (z + size.z * y)] = paletteIndices.get(key);
  };

  for (let x = 0; x < size.x; x++) {
    for (let z = 0; z < size.z; z++) {
      put(x, 0, z, "stone_bricks");
    }
  }

  const stairs = [
    [1, 2, "north", "bottom", "straight"],
    [3, 2, "east", "bottom", "inner_left"],
    [5, 2, "south", "bottom", "inner_right"],
    [7, 2, "west", "bottom", "outer_left"],
    [1, 4, "north", "top", "outer_right"],
    [3, 4, "east", "top", "inner_left"],
    [5, 4, "south", "top", "straight"],
    [7, 4, "west", "bottom", "outer_right"],
  ];
  for (const [x, z, facing, half, shape] of stairs) {
    put(x, 1, z, "oak_stairs", {
      facing,
      half,
      shape,
      waterlogged: "false",
    });
  }

  const fences = [
    [1, 8],
    [2, 8],
    [3, 8],
    [4, 8],
    [5, 8],
    [3, 7],
    [3, 9],
  ];
  const fenceAt = (x, z) =>
    String(fences.some(([otherX, otherZ]) => otherX === x && otherZ === z));
  for (const [x, z] of fences) {
    put(x, 1, z, "oak_fence", {
      east: fenceAt(x + 1, z),
      west: fenceAt(x - 1, z),
      north: fenceAt(x, z - 1),
      south: fenceAt(x, z + 1),
      waterlogged: "false",
    });
  }
  put(5, 1, 9, "oak_fence_gate", {
    facing: "north",
    open: "false",
    in_wall: "false",
    powered: "false",
  });

  for (const [x, facing, hinge, open] of [
    [1, "north", "left", "false"],
    [3, "north", "left", "true"],
    [5, "east", "right", "true"],
  ]) {
    for (const [y, half] of [
      [1, "lower"],
      [2, "upper"],
    ]) {
      put(x, y, 12, "oak_door", {
        facing,
        half,
        hinge,
        open,
        powered: "false",
      });
    }
  }

  put(11, 1, 14, "stone_bricks");
  for (const [x, y, z, shape] of [
    [7, 1, 12, "east_west"],
    [8, 1, 12, "south_west"],
    [8, 1, 13, "north_south"],
    [8, 1, 14, "north_east"],
    [9, 1, 14, "east_west"],
    [10, 1, 14, "ascending_east"],
    [11, 2, 14, "east_west"],
  ]) {
    put(x, y, z, "rail", { shape, waterlogged: "false" });
  }

  // Three walls overlap in depth, with opaque colored blocks behind/between.
  for (let x = 12; x <= 19; x++) {
    for (let y = 1; y <= 3; y++) {
      put(
        x,
        y,
        0,
        ["white_concrete", "yellow_concrete", "blue_concrete"][x % 3]
      );
      put(x, y, 1, "red_stained_glass");
      put(x, y, 3, "blue_stained_glass");
      put(x, y, 5, "glass");
    }
  }
  put(14, 1, 2, "lime_concrete");
  put(14, 2, 2, "lime_concrete");

  // A contained pool includes adjacent source/flowing water and a wet slab.
  for (let x = 12; x <= 19; x++) {
    for (let z = 9; z <= 15; z++) {
      if (x === 12 || x === 19 || z === 9 || z === 15) {
        put(x, 1, z, "prismarine_bricks");
      } else {
        put(x, 1, z, "water", { level: x === 18 ? "3" : "0" });
      }
    }
  }
  put(14, 1, 12, "oak_slab", { type: "bottom", waterlogged: "true" });

  return encodeLitematicFixture({
    name: "Vanilla models and transparency showcase",
    regionName: "Showcase",
    palette,
    size,
    blocks,
  });
}
