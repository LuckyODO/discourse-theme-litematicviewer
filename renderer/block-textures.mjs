import { ATLAS } from "./generated/texture-atlas.mjs";

const DIRECTIONS = ["north", "east", "south", "west"];
const FACE_DIRECTIONS = ["west", "east", "down", "up", "north", "south"];
const WOODS = new Set([
  "oak",
  "spruce",
  "birch",
  "jungle",
  "acacia",
  "dark_oak",
  "mangrove",
  "cherry",
  "pale_oak",
  "poplar",
  "bamboo",
  "crimson",
  "warped",
]);
const BASE_ALIASES = {
  brick: "bricks",
  stone_brick: "stone_bricks",
  mossy_stone_brick: "mossy_stone_bricks",
  nether_brick: "nether_bricks",
  red_nether_brick: "red_nether_bricks",
  end_stone_brick: "end_stone_bricks",
  prismarine_brick: "prismarine_bricks",
  mud_brick: "mud_bricks",
  polished_blackstone_brick: "polished_blackstone_bricks",
  deepslate_brick: "deepslate_bricks",
  deepslate_tile: "deepslate_tiles",
  tuff_brick: "tuff_bricks",
  resin_brick: "resin_bricks",
  quartz: "quartz_block",
  smooth_quartz: "quartz_block",
  purpur: "purpur_block",
};

function linear(hex) {
  return [0, 2, 4].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
}

const WHITE = [1, 1, 1];
const GRASS = linear("91bd59");
const LEAVES = linear("77ab2f");
const BIRCH = linear("80a755");
const SPRUCE = linear("619961");

// Each pair is an affine function of the face's original block coordinates:
// X faces use (y,z), Y faces (x,z), Z faces (x,y). Texture V grows downward.
// Keeping these coordinates, even after face clipping, avoids stretched slabs.
const PROJECTIONS = [
  [
    [0, 1, 0],
    [-1, 0, 1],
  ],
  [
    [0, -1, 1],
    [-1, 0, 1],
  ],
  [
    [1, 0, 0],
    [0, -1, 1],
  ],
  [
    [1, 0, 0],
    [0, 1, 0],
  ],
  [
    [-1, 0, 1],
    [0, -1, 1],
  ],
  [
    [1, 0, 0],
    [0, -1, 1],
  ],
];

function projection(face, turns) {
  let [u, v] = PROJECTIONS[face];
  for (let index = 0; index < turns; index++) {
    [u, v] = [[-v[0], -v[1], 1 - v[2]], u];
  }
  return [u, v];
}

function baseTexture(id) {
  let base = id.replace(/_(slab|stairs|fence_gate|fence|wall)$/, "");
  if (WOODS.has(base)) {
    return `${base}_planks`;
  }
  if (base.startsWith("waxed_") && base.includes("copper")) {
    base = base.slice(6);
  }
  return BASE_ALIASES[base] || base;
}

function doorFacing(properties) {
  let facing = properties.facing || "north";
  if (properties.open === "true") {
    const turn = properties.hinge === "right" ? 3 : 1;
    facing = DIRECTIONS[(DIRECTIONS.indexOf(facing) + turn) % 4];
  }
  return facing;
}

function textureChoice(id, properties, face) {
  const axis = Math.floor(face / 2);
  const sign = face % 2 ? 1 : -1;
  const direction = FACE_DIRECTIONS[face];
  const top = axis === 1 && sign > 0;
  const bottom = axis === 1 && sign < 0;
  let name = baseTexture(id);
  let tint = WHITE;
  let turns = 0;

  // A single texture is deliberately not guessed for multipart entities or
  // stateful plants whose atlas names do not describe their full block model.
  if (/chest|_bed$|torch$|rail$|repeater|comparator|redstone_wire/.test(id)) {
    return { name: "__white", tint, turns };
  }

  const log = id.match(
    /^(stripped_)?(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|poplar)_(log|wood)$/
  );
  const stem = id.match(/^(stripped_)?(crimson|warped)_(stem|hyphae)$/);
  if (log || stem) {
    const match = log || stem;
    const side = `${match[1] || ""}${match[2]}_${log ? "log" : "stem"}`;
    const grain = { x: 0, y: 1, z: 2 }[properties.axis || "y"] ?? 1;
    const allBark = match[3] === "wood" || match[3] === "hyphae";
    name = axis === grain && !allBark ? `${side}_top` : side;
    if (axis !== grain && grain !== 1 && !(axis === 1 && grain === 2)) {
      turns = 1;
    }
  } else if (id === "grass_block") {
    const snowy = properties.snowy === "true";
    name = bottom
      ? "dirt"
      : top
        ? snowy
          ? "snow"
          : "grass_block_top"
        : snowy
          ? "grass_block_snow"
          : "grass_block_side";
    if (top && !snowy) {
      tint = GRASS;
    }
  } else if (id.endsWith("_leaves")) {
    if (id === "birch_leaves") {
      tint = BIRCH;
    } else if (id === "spruce_leaves") {
      tint = SPRUCE;
    } else if (
      !/^(cherry|pale_oak|azalea|flowering_azalea|red_poplar|orange_poplar|yellow_poplar)_leaves$/.test(
        id
      )
    ) {
      tint = LEAVES;
    }
  } else if (id === "short_grass" || id === "fern" || id === "vine") {
    tint = GRASS;
  } else if (id === "podzol" || id === "mycelium" || id === "dirt_path") {
    name = bottom ? "dirt" : `${id}_${top ? "top" : "side"}`;
  } else if (id === "farmland") {
    name = top
      ? Number(properties.moisture) > 0
        ? "farmland_moist"
        : "farmland"
      : "dirt";
  } else if (id === "glass_pane" || id.endsWith("_stained_glass_pane")) {
    name = id.slice(0, -5);
  } else if (id.endsWith("_trapdoor")) {
    const open = properties.open === "true";
    const facing = properties.facing || "north";
    const broadAxis = open
      ? facing === "east" || facing === "west"
        ? 0
        : 2
      : 1;
    const wood = id.slice(0, -9);
    name =
      axis === broadAxis
        ? id
        : WOODS.has(wood)
          ? `${wood}_planks`
          : wood === "iron"
            ? "iron_block"
            : baseTexture(wood);
    if (!open && axis === 1) {
      turns = Math.max(0, DIRECTIONS.indexOf(facing));
    }
  } else if (id.endsWith("_door")) {
    const facing = doorFacing(properties);
    const broadAxis = facing === "east" || facing === "west" ? 0 : 2;
    const wood = id.slice(0, -5);
    name =
      axis === broadAxis
        ? `${id}_${properties.half === "upper" ? "top" : "bottom"}`
        : WOODS.has(wood)
          ? `${wood}_planks`
          : wood === "iron"
            ? "iron_block"
            : baseTexture(wood);
  } else if (["furnace", "blast_furnace", "smoker"].includes(id)) {
    name =
      axis === 1
        ? `${id}_${id === "smoker" && bottom ? "bottom" : "top"}`
        : direction === (properties.facing || "north")
          ? `${id}_front${properties.lit === "true" ? "_on" : ""}`
          : `${id}_side`;
  } else if (id === "dispenser" || id === "dropper") {
    name =
      direction === (properties.facing || "north")
        ? `${id}_front${axis === 1 ? "_vertical" : ""}`
        : axis === 1
          ? "furnace_top"
          : "furnace_side";
  } else if (id === "barrel") {
    const facing = FACE_DIRECTIONS.indexOf(properties.facing || "up");
    name =
      face === facing
        ? `barrel_top${properties.open === "true" ? "_open" : ""}`
        : face === (facing % 2 ? facing - 1 : facing + 1)
          ? "barrel_bottom"
          : "barrel_side";
    const grain = Math.floor(facing / 2);
    if (axis !== grain && grain !== 1 && !(axis === 1 && grain === 2)) {
      turns = 1;
    }
  } else if (id === "crafting_table") {
    name = top
      ? "crafting_table_top"
      : bottom
        ? "oak_planks"
        : face === 0 || face === 5
          ? "crafting_table_front"
          : "crafting_table_side";
  } else if (["pumpkin", "carved_pumpkin", "jack_o_lantern"].includes(id)) {
    name =
      axis === 1
        ? "pumpkin_top"
        : id !== "pumpkin" && direction === (properties.facing || "north")
          ? id
          : "pumpkin_side";
  } else if (id === "bookshelf") {
    name = axis === 1 ? "oak_planks" : "bookshelf";
  } else if (id === "tnt") {
    name = `tnt_${top ? "top" : bottom ? "bottom" : "side"}`;
  } else if (id === "cactus") {
    name = `cactus_${top ? "top" : bottom ? "bottom" : "side"}`;
  } else if (id === "snow" || id === "snow_block") {
    name = "snow";
  } else if (id === "water" || id === "lava") {
    name = `${id}_still`;
    if (id === "water") {
      tint = linear("3f76e4");
    }
  } else if (id === "moss_carpet") {
    name = "moss_block";
  } else if (id === "pale_moss_carpet") {
    name = "pale_moss_carpet";
  } else if (id.endsWith("_carpet")) {
    name = id.replace(/_carpet$/, "_wool");
  } else if (name === "smooth_stone") {
    name =
      axis === 1 || !id.endsWith("_slab")
        ? "smooth_stone"
        : "smooth_stone_slab_side";
  } else if (name === "quartz_block") {
    name = id.startsWith("smooth_")
      ? "quartz_block_top"
      : `quartz_block_${top ? "top" : bottom ? "bottom" : "side"}`;
  } else if (name === "blackstone" || name === "chiseled_quartz_block") {
    name = axis === 1 ? `${name}_top` : name;
  } else if (name === "sandstone" || name === "red_sandstone") {
    name = axis === 1 ? `${name}_${top ? "top" : "bottom"}` : name;
  } else if (/^(cut|chiseled|smooth)_(red_)?sandstone$/.test(name)) {
    const sandstone = name.includes("red_") ? "red_sandstone" : "sandstone";
    name = name.startsWith("smooth_")
      ? `${sandstone}_top`
      : axis === 1
        ? `${sandstone}_top`
        : name;
  } else if (
    [
      "quartz_pillar",
      "purpur_pillar",
      "bone_block",
      "hay_block",
      "basalt",
      "polished_basalt",
      "deepslate",
      "bamboo_block",
      "stripped_bamboo_block",
    ].includes(id)
  ) {
    const grain = { x: 0, y: 1, z: 2 }[properties.axis || "y"] ?? 1;
    name =
      axis === grain
        ? `${id}_top`
        : id === "deepslate" || id.endsWith("bamboo_block")
          ? id
          : `${id}_side`;
    if (axis !== grain && grain !== 1 && !(axis === 1 && grain === 2)) {
      turns = 1;
    }
  }
  return { name, tint, turns };
}

/** Face order: -X,+X,-Y,+Y,-Z,+Z. Atlas rectangles exclude their padding.
 * Unsupported blocks retain a white tile and the mesher's original colors. */
export function blockTextures(entry, atlas = ATLAS) {
  const name = typeof entry === "string" ? entry : entry.name;
  const properties = entry.properties || {};
  const vanilla = name?.startsWith("minecraft:");
  const id = vanilla ? name.slice(10) : "";
  return FACE_DIRECTIONS.map((_direction, face) => {
    const choice = vanilla
      ? textureChoice(id, properties, face)
      : { name: "__white", tint: WHITE, turns: 0 };
    const textured =
      choice.name !== "__white" && Object.hasOwn(atlas.tiles, choice.name);
    const tileName = textured ? choice.name : "__white";
    const tile = atlas.tiles[tileName];
    const [u, v] = projection(face, choice.turns);
    const du = tile.width / atlas.width;
    const dv = tile.height / atlas.height;
    return {
      name: tileName,
      textured,
      cutout:
        textured &&
        (tile.cutout || tile.translucent || /glass|leaves|water|ice/.test(id)),
      tint: textured ? choice.tint : WHITE,
      uv: [
        u[0] * du,
        u[1] * du,
        tile.x / atlas.width + u[2] * du,
        -v[0] * dv,
        -v[1] * dv,
        1 - tile.y / atlas.height - v[2] * dv,
      ],
    };
  });
}
