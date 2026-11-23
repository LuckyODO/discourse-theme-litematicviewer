import { encodeLitematicFixture } from "./litematic-fixture.mjs";

// Original fixture: entity-backed blocks, including two different designs
// sharing one banner palette entry. This catches caching by palette alone.
export function createSpecialShowcaseFixture({ patterns = true } = {}) {
  const size = { x: 16, y: 5, z: 13 };
  const palette = [{ name: "air" }];
  const keys = new Map();
  const blocks = new Array(size.x * size.y * size.z).fill(0);
  const tileEntities = [];
  const put = (x, y, z, name, properties = {}, data) => {
    const key = JSON.stringify([name, properties]);
    if (!keys.has(key)) {
      keys.set(key, palette.length);
      palette.push({ name, properties });
    }
    blocks[x + size.x * (z + size.z * y)] = keys.get(key);
    if (data) {
      tileEntities.push({ x, y, z, ...data });
    }
  };
  for (let x = 0; x < size.x; x++) {
    for (let z = 0; z < size.z; z++) {
      put(x, 0, z, "smooth_stone");
    }
  }
  put(2, 1, 2, "chest", {
    facing: "south",
    type: "single",
    waterlogged: "false",
  });
  put(4, 1, 2, "chest", {
    facing: "south",
    type: "right",
    waterlogged: "false",
  });
  put(5, 1, 2, "chest", {
    facing: "south",
    type: "left",
    waterlogged: "false",
  });
  put(7, 1, 2, "trapped_chest", {
    facing: "south",
    type: "single",
    waterlogged: "false",
  });
  put(9, 1, 2, "ender_chest", { facing: "south", waterlogged: "false" });
  put(12, 1, 2, "red_shulker_box", { facing: "up" });
  put(14, 1, 2, "blue_shulker_box", { facing: "north" });
  put(
    2,
    1,
    6,
    "white_banner",
    { rotation: "0" },
    patterns
      ? {
          patterns: [
            { color: "blue", pattern: "minecraft:stripe_center" },
            { color: "red", pattern: "minecraft:border" },
          ],
        }
      : undefined
  );
  put(
    4,
    1,
    6,
    "white_banner",
    { rotation: "0" },
    patterns
      ? {
          Patterns: [
            { Color: 14, Pattern: "cr" },
            { Color: 15, Pattern: "bo" },
          ],
        }
      : undefined
  );
  put(6, 1, 6, "red_banner", { rotation: "4" });
  put(8, 1, 5, "stone_bricks");
  put(8, 2, 5, "stone_bricks");
  put(
    8,
    2,
    6,
    "blue_wall_banner",
    { facing: "south" },
    patterns
      ? {
          patterns: [{ color: "yellow", pattern: "minecraft:rhombus" }],
        }
      : undefined
  );
  put(11, 1, 5, "red_bed", {
    facing: "south",
    part: "foot",
    occupied: "false",
  });
  put(11, 1, 6, "red_bed", {
    facing: "south",
    part: "head",
    occupied: "false",
  });
  put(14, 1, 6, "bell", {
    facing: "south",
    attachment: "floor",
    powered: "false",
  });
  put(2, 1, 10, "oak_sign", { rotation: "0", waterlogged: "false" });
  put(5, 2, 10, "oak_hanging_sign", {
    rotation: "0",
    attached: "false",
    waterlogged: "false",
  });
  put(8, 1, 10, "skeleton_skull", { rotation: "0" });
  put(10, 1, 10, "creeper_head", { rotation: "4" });
  put(
    12,
    1,
    10,
    "decorated_pot",
    { facing: "south", cracked: "false", waterlogged: "false" },
    {
      sherds: [
        "minecraft:angler_pottery_sherd",
        "minecraft:archer_pottery_sherd",
        "minecraft:prize_pottery_sherd",
        "minecraft:skull_pottery_sherd",
      ],
    }
  );
  put(14, 1, 10, "conduit", { waterlogged: "false" });
  return encodeLitematicFixture({
    name: "Special block showcase",
    regionName: "Special blocks",
    palette,
    size,
    blocks,
    tileEntities,
  });
}
