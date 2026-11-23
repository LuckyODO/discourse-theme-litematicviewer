/*!
 * Special-model geometry and UV references adapted from deepslate:
 * https://github.com/misode/deepslate/blob/main/src/render/SpecialRenderer.ts
 * MIT License — Copyright (c) 2021 Misode
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { ATLAS } from "./generated/texture-atlas.mjs";
import { resolveVanillaModel } from "./vanilla-models.mjs";

// Minecraft 26.3 ChestModel / DecoratedPotRenderer constants were also checked
// against the pinned official client. Only static resource geometry is encoded.
// Gudu-Z/LitematicWebViewer was consulted for feature scope, not copied: that
// repository has no license file. No entity animation, skin service or network
// dependency is introduced by these batched static models.
const DIRECTIONS = ["west", "east", "down", "up", "north", "south"];
const DYES = [
  "white",
  "orange",
  "magenta",
  "light_blue",
  "yellow",
  "lime",
  "pink",
  "gray",
  "light_gray",
  "cyan",
  "purple",
  "blue",
  "brown",
  "green",
  "red",
  "black",
];
const DYE_RGB = [
  0xf9fffe, 0xf9801d, 0xc74ebd, 0x3ab3da, 0xfed83d, 0x80c71f, 0xf38baa,
  0x474f52, 0x9d9d97, 0x169c9c, 0x8932b8, 0x3c44aa, 0x835432, 0x5e7c16,
  0xb02e26, 0x1d1d21,
];
const PATTERN_NAMES = {
  b: "base",
  bl: "square_bottom_left",
  br: "square_bottom_right",
  tl: "square_top_left",
  tr: "square_top_right",
  bs: "stripe_bottom",
  ts: "stripe_top",
  ls: "stripe_left",
  rs: "stripe_right",
  cs: "stripe_center",
  ms: "stripe_middle",
  drs: "stripe_downright",
  dls: "stripe_downleft",
  ss: "small_stripes",
  cr: "cross",
  sc: "straight_cross",
  bt: "triangle_bottom",
  tt: "triangle_top",
  bts: "triangles_bottom",
  tts: "triangles_top",
  ld: "diagonal_left",
  rd: "diagonal_up_right",
  lud: "diagonal_up_left",
  rud: "diagonal_right",
  mc: "circle",
  mr: "rhombus",
  vh: "half_vertical",
  hh: "half_horizontal",
  vhr: "half_vertical_right",
  hhb: "half_horizontal_bottom",
  bo: "border",
  cbo: "curly_border",
  bri: "bricks",
  gra: "gradient",
  gru: "gradient_up",
  cre: "creeper",
  sku: "skull",
  flo: "flower",
  moj: "mojang",
  glb: "globe",
  pig: "piglin",
  flw: "flow",
  gus: "guster",
};
const WHITE = [1, 1, 1];
const MODEL_CACHE = new Map();
let cachedFaceCount = 0;
const MAX_CACHE_MODELS = 1024;
const MAX_CACHE_FACES = 32_768;

function dye(value, fallback = "white") {
  if (Number.isInteger(value) && value >= 0 && value < 16) {
    return DYES[value];
  }
  return typeof value === "string" &&
    DYES.includes(value.replace(/^minecraft:/, ""))
    ? value.replace(/^minecraft:/, "")
    : fallback;
}

function tint(color) {
  const rgb = DYE_RGB[DYES.indexOf(color)] ?? DYE_RGB[0];
  return [Math.floor(rgb / 65536), Math.floor(rgb / 256) % 256, rgb % 256].map(
    (channel) => {
      const value = channel / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    }
  );
}

function blockId(entry) {
  const name = typeof entry === "string" ? entry : entry?.name;
  return name?.startsWith("minecraft:") ? name.slice(10) : "";
}

function patternsFor(blockEntity) {
  const source = blockEntity?.patterns ?? blockEntity?.Patterns ?? [];
  if (!Array.isArray(source)) {
    return [];
  }
  if (source.length > 16) {
    const error = new Error(
      "Banner patterns exceed the 16-layer preview limit."
    );
    error.category = "too_complex";
    throw error;
  }
  return source.flatMap((item) => {
    const raw = item?.pattern ?? item?.Pattern;
    const name = typeof raw === "string" ? raw : raw?.asset_id;
    if (typeof name !== "string" || !/^(?:minecraft:)?[a-z_]+$/.test(name)) {
      return [];
    }
    const short = name.replace(/^minecraft:/, "");
    const pattern = Object.hasOwn(PATTERN_NAMES, short)
      ? PATTERN_NAMES[short]
      : short;
    return Object.hasOwn(ATLAS.tiles, `entity/banner/${pattern}`)
      ? [{ pattern, color: dye(item.color ?? item.Color) }]
      : [];
  });
}

export function normalizeSpecialData(entry, blockEntity = null) {
  const id = blockId(entry);
  if (id.endsWith("_banner") || id === "banner" || id === "wall_banner") {
    const named = id.replace(/_(?:wall_)?banner$/, "");
    return {
      color: dye(DYES.includes(named) ? named : blockEntity?.Base),
      patterns: patternsFor(blockEntity),
    };
  }
  if (id === "decorated_pot") {
    const values = blockEntity?.sherds ?? blockEntity?.Sherds;
    return {
      sherds: Array.from({ length: 4 }, (_value, index) => {
        const item = Array.isArray(values) ? values[index] : "";
        if (
          typeof item !== "string" ||
          !/^minecraft:[a-z_]+_pottery_sherd$/.test(item)
        ) {
          return "decorated_pot_side";
        }
        const pattern = item.slice(10).replace(/_sherd$/, "_pattern");
        return Object.hasOwn(ATLAS.tiles, `entity/decorated_pot/${pattern}`)
          ? pattern
          : "decorated_pot_side";
      }),
    };
  }
  return null;
}

/** Only appearance data participates in batching; positions/inventories do not. */
export function specialModelKey(entry, blockEntity = null) {
  const data = normalizeSpecialData(entry, blockEntity);
  return data ? JSON.stringify(data) : "";
}

function rotate(point, axis, degrees, origin = [8, 8, 8]) {
  const radians = (degrees * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const [x, y, z] = point.map((value, index) => value - origin[index]);
  const result =
    axis === "x"
      ? [x, y * c - z * s, y * s + z * c]
      : axis === "y"
        ? [x * c + z * s, y, -x * s + z * c]
        : [x * c - y * s, x * s + y * c, z];
  return result.map((value, index) => value + origin[index]);
}

function southRotation(facing) {
  return { south: 0, east: 90, north: 180, west: 270 }[facing] ?? 0;
}

function directionVertices(from, to, direction) {
  const [x0, y0, z0] = from;
  const [x1, y1, z1] = to;
  return [
    [
      [x0, y1, z0],
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
    ],
    [
      [x1, y1, z1],
      [x1, y0, z1],
      [x1, y0, z0],
      [x1, y1, z0],
    ],
    [
      [x0, y0, z1],
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
    ],
    [
      [x0, y1, z0],
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y1, z0],
    ],
    [
      [x1, y1, z0],
      [x1, y0, z0],
      [x0, y0, z0],
      [x0, y1, z0],
    ],
    [
      [x0, y1, z1],
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
    ],
  ][direction];
}

function faceNormal(vertices) {
  const a = vertices[1].map((value, index) => value - vertices[0][index]);
  const b = vertices[2].map((value, index) => value - vertices[0][index]);
  const cross = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const length = Math.hypot(...cross);
  return length > 1e-10 ? cross.map((value) => value / length) : null;
}

// Standard entity cube unwrap, measured in source PNG pixels. The front is +Z.
function cubeUv(width, height, depth, u = 0, v = 0) {
  return {
    west: [
      u + 2 * depth + width,
      v + depth,
      u + depth + width,
      v + depth + height,
    ],
    east: [u + depth, v + depth, u, v + depth + height],
    down: [u + depth + width, v, u + depth + 2 * width, v + depth],
    up: [u + depth, v, u + depth + width, v + depth],
    north: [
      u + 2 * depth + width,
      v + depth,
      u + 2 * depth + 2 * width,
      v + depth + height,
    ],
    south: [u + depth, v + depth, u + depth + width, v + depth + height],
  };
}

function builder() {
  const faces = [];
  let supported = true;
  function box(
    texture,
    from,
    to,
    uv,
    {
      color = WHITE,
      transform = (point) => point,
      omit = [],
      forceCutout = false,
    } = {}
  ) {
    const tile = Object.hasOwn(ATLAS.tiles, texture)
      ? ATLAS.tiles[texture]
      : null;
    if (!tile) {
      supported = false;
      return;
    }
    for (const [direction, rect] of Object.entries(uv)) {
      if (omit.includes(direction)) {
        continue;
      }
      const index = DIRECTIONS.indexOf(direction);
      const vertices = directionVertices(from, to, index).map(transform);
      const normal = faceNormal(vertices);
      if (!normal) {
        continue;
      }
      const [u0, v0, u1, v1] = rect;
      const uvs = [
        [u0, v0],
        [u0, v1],
        [u1, v1],
        [u1, v0],
      ].flatMap(([u, v]) => [
        (tile.x + u) / ATLAS.width,
        1 - (tile.y + v) / ATLAS.height,
      ]);
      faces.push({
        vertices: vertices.flatMap((point) => point.map((value) => value / 16)),
        uvs,
        normal,
        cullface: -1,
        tint: color,
        layer: tile.translucent && !forceCutout ? "translucent" : "opaque",
        shade: true,
        shadeNormal: normal,
        cutout: tile.cutout || forceCutout,
        texture,
      });
    }
  }
  return {
    faces,
    box,
    finish: () => ({
      supported,
      reason: supported ? "" : "texture",
      faces,
      occlusion: Array.from({ length: 6 }, () => []),
    }),
  };
}

function chest(id, properties) {
  const result = builder();
  const type =
    id === "ender_chest"
      ? "single"
      : ["left", "right"].includes(properties.type)
        ? properties.type
        : "single";
  const clean = id.replace(/^waxed_/, "");
  const copper = clean.includes("copper_chest");
  const base = copper
    ? `copper${clean === "copper_chest" ? "" : `_${clean.split("_")[0]}`}`
    : id === "ender_chest"
      ? "ender"
      : id === "trapped_chest"
        ? "trapped"
        : "normal";
  const texture = `entity/chest/${base}${type === "single" ? "" : `_${type}`}`;
  const x0 = type === "left" ? 0 : 1;
  const x1 = type === "right" ? 16 : 15;
  const width = x1 - x0;
  const transform = (point) =>
    rotate(point, "y", southRotation(properties.facing || "north"));
  const omit = type === "left" ? ["west"] : type === "right" ? ["east"] : [];
  result.box(texture, [x0, 0, 1], [x1, 10, 15], cubeUv(width, 10, 14, 0, 19), {
    transform,
    omit: [...omit, "up"],
  });
  result.box(texture, [x0, 9, 1], [x1, 14, 15], cubeUv(width, 5, 14), {
    transform,
    omit: [...omit, "down"],
  });
  const lockX = type === "left" ? 0 : type === "right" ? 15 : 7;
  const lockWidth = type === "single" ? 2 : 1;
  result.box(
    texture,
    [lockX, 7, 15],
    [lockX + lockWidth, 11, 16],
    cubeUv(lockWidth, 4, 1),
    { transform, omit }
  );
  return result.finish();
}

function shulker(id, properties) {
  const result = builder();
  const color = id.replace(/_?shulker_box$/, "");
  const texture = `entity/shulker/shulker${color ? `_${color}` : ""}`;
  const transform = (point) => {
    const facing = properties.facing || "up";
    if (facing === "up") {
      return point;
    }
    if (facing === "down") {
      return rotate(point, "x", 180);
    }
    return rotate(rotate(point, "x", 90), "y", southRotation(facing));
  };
  const bottomUv = {
    north: [16, 44, 32, 52],
    east: [0, 44, 16, 52],
    south: [48, 44, 64, 52],
    west: [32, 44, 48, 52],
    down: [48, 28, 32, 44],
  };
  const topUv = {
    north: [16, 16, 32, 28],
    east: [0, 16, 16, 28],
    south: [48, 16, 64, 28],
    west: [32, 16, 48, 28],
    up: [32, 16, 16, 0],
  };
  // Only visible portions are emitted: the lid overlaps the base by four pixels.
  for (const name of ["north", "east", "south", "west"]) {
    bottomUv[name][1] = 48;
  }
  result.box(texture, [0, 0, 0], [16, 4, 16], bottomUv, { transform });
  result.box(texture, [0, 4, 0], [16, 16, 16], topUv, { transform });
  const model = result.finish();
  if (model.supported) {
    model.occlusion = Array.from({ length: 6 }, () => [[0, 0, 1, 1]]);
  }
  return model;
}

function banner(id, properties, data) {
  const result = builder();
  const wall = id.includes("wall_banner");
  const rotation = Number(properties.rotation);
  const angle = wall
    ? southRotation(properties.facing || "north")
    : Number.isFinite(rotation)
      ? -(rotation % 16) * 22.5
      : 0;
  const transform = (point) => {
    const scaled = wall
      ? [
          8 + ((point[0] - 8) * 2) / 3,
          8 + ((point[1] - 23.2) * 2) / 3,
          8 + ((point[2] - 8) * 2) / 3,
        ]
      : [
          8 + ((point[0] - 8) * 2) / 3,
          24 + ((point[1] - 24) * 2) / 3,
          8 + ((point[2] - 8) * 2) / 3,
        ];
    return rotate(scaled, "y", angle);
  };
  const clothZ = wall ? -1.5 : 6;
  const clothUv = {
    north: [1, 1, 21, 41],
    east: [0, 1, 1, 41],
    south: [22, 1, 42, 41],
    west: [21, 1, 22, 41],
    up: [21, 1, 1, 0],
    down: [41, 0, 21, 1],
  };
  result.box(
    "entity/banner/banner_base",
    [-2, -8, clothZ],
    [18, 32, clothZ + 1],
    clothUv,
    { color: tint(data.color), transform }
  );
  if (!wall) {
    result.box(
      "entity/banner/banner_base",
      [7, -12, 7],
      [9, 30, 9],
      cubeUv(2, 42, 2, 44, 0),
      { transform }
    );
  }
  result.box(
    "entity/banner/banner_base",
    [-2, 30, wall ? -3.5 : 7],
    [18, 32, wall ? -1.5 : 9],
    cubeUv(20, 2, 2, 0, 42),
    { transform }
  );
  data.patterns.forEach((pattern, index) => {
    const offset = (index + 1) * 0.006;
    result.box(
      `entity/banner/${pattern.pattern}`,
      [-2 - offset, -8 - offset, clothZ - offset],
      [18 + offset, 32 + offset, clothZ + 1 + offset],
      clothUv,
      { color: tint(pattern.color), transform }
    );
  });
  return result.finish();
}

function pot(properties, data) {
  const result = builder();
  const transform = (point) =>
    rotate(point, "y", southRotation(properties.facing || "north"));
  const mapping = { north: 0, west: 1, east: 2, south: 3 };
  for (const [side, index] of Object.entries(mapping)) {
    result.box(
      `entity/decorated_pot/${data.sherds[index]}`,
      [1, 0, 1],
      [15, 16, 15],
      { [side]: [1, 0, 15, 16] },
      { transform }
    );
  }
  const texture = "entity/decorated_pot/decorated_pot_base";
  result.box(
    texture,
    [1, 0, 1],
    [15, 16, 15],
    { up: [0, 13, 14, 27], down: [14, 13, 28, 27] },
    { transform }
  );
  result.box(
    texture,
    [4.8, 15.8, 4.8],
    [11.2, 17.2, 11.2],
    cubeUv(6, 1, 6, 0, 5),
    { transform, omit: ["up", "down"] }
  );
  result.box(texture, [4.1, 17.1, 4.1], [11.9, 19.9, 11.9], cubeUv(8, 3, 8), {
    transform,
  });
  return result.finish();
}

const HEAD_TEXTURES = {
  skeleton: "skeleton/skeleton",
  wither_skeleton: "skeleton/wither_skeleton",
  zombie: "zombie/zombie",
  creeper: "creeper/creeper",
  player: "player/wide/steve",
  piglin: "piglin/piglin",
  dragon: "enderdragon/dragon",
};

function head(id, properties) {
  const kind = id.replace(/_(?:wall_)?(?:head|skull)$/, "");
  if (!Object.hasOwn(HEAD_TEXTURES, kind)) {
    return null;
  }
  const result = builder();
  const texture = `entity/${HEAD_TEXTURES[kind]}`;
  const wall = id.includes("_wall_");
  const rotation = Number(properties.rotation);
  const facing = properties.facing || "north";
  const angle = wall
    ? southRotation(facing)
    : Number.isFinite(rotation)
      ? -(rotation % 16) * 22.5
      : 0;
  const transform = (point) => {
    let rotated = rotate(point, "y", angle);
    if (wall) {
      const normal = {
        north: [0, 0, -1],
        south: [0, 0, 1],
        east: [1, 0, 0],
        west: [-1, 0, 0],
      }[facing] || [0, 0, -1];
      rotated = [
        rotated[0] - normal[0] * 4,
        rotated[1] + 4,
        rotated[2] - normal[2] * 4,
      ];
    }
    return rotated;
  };
  if (kind === "dragon") {
    const dragonTransform = (point) =>
      transform([
        8 + (8 - point[0]) * 0.75,
        8 + (point[1] - 11.2) * 0.75,
        8 + (8 - point[2]) * 0.75,
      ]);
    result.box(texture, [0, 0, -2], [16, 16, 14], cubeUv(16, 16, 16, 112, 30), {
      transform: dragonTransform,
    });
    result.box(texture, [2, 4, -16], [14, 9, 0], cubeUv(12, 5, 16, 176, 44), {
      transform: dragonTransform,
    });
    result.box(texture, [2, 0, -16], [14, 4, 0], cubeUv(12, 4, 16, 176, 65), {
      transform: dragonTransform,
    });
    for (const x of [3, 11]) {
      result.box(texture, [x, 16, 4], [x + 2, 20, 10], cubeUv(2, 4, 6), {
        transform: dragonTransform,
      });
      result.box(
        texture,
        [x, 9, -14],
        [x + 2, 11, -10],
        cubeUv(2, 2, 4, 112, 0),
        { transform: dragonTransform }
      );
    }
  } else if (kind === "piglin") {
    result.box(texture, [3, 0, 4], [13, 8, 12], cubeUv(10, 8, 8), {
      transform,
    });
    result.box(texture, [6, 0, 12], [10, 4, 13], cubeUv(4, 4, 1, 31, 1), {
      transform,
    });
    for (const x of [5, 10]) {
      result.box(
        texture,
        [x, 0, 12],
        [x + 1, 2, 13],
        cubeUv(1, 2, 1, 2, x === 5 ? 0 : 4),
        { transform }
      );
    }
    for (const [x, angleZ, u] of [
      [3, -30, 39],
      [13, 30, 51],
    ]) {
      result.box(
        texture,
        [x - 0.5, 1.5, 6],
        [x + 0.5, 6.5, 10],
        cubeUv(1, 5, 4, u, 6),
        {
          transform: (point) =>
            transform(rotate(point, "z", angleZ, [x, 7, 8])),
        }
      );
    }
  } else {
    result.box(texture, [4, 0, 4], [12, 8, 12], cubeUv(8, 8, 8), { transform });
    if (kind === "player") {
      result.box(
        texture,
        [3.75, -0.25, 3.75],
        [12.25, 8.25, 12.25],
        cubeUv(8, 8, 8, 32, 0),
        { transform }
      );
    }
  }
  return result.finish();
}

function bell(entry) {
  const result = builder();
  const base = resolveVanillaModel(entry);
  if (base?.supported) {
    result.faces.push(...base.faces);
  }
  const transform = (point) => rotate(point, "x", 180);
  const texture = "entity/bell/bell_body";
  result.box(
    texture,
    [5, 3, 5],
    [11, 10, 11],
    {
      north: [6, 6, 12, 13],
      east: [0, 6, 6, 13],
      south: [18, 6, 24, 13],
      west: [12, 6, 18, 13],
      up: [12, 6, 6, 0],
      down: [18, 0, 12, 6],
    },
    { transform }
  );
  result.box(
    texture,
    [4, 10, 4],
    [12, 12, 12],
    {
      north: [8, 21, 16, 23],
      east: [0, 21, 8, 23],
      south: [24, 21, 32, 23],
      west: [16, 21, 24, 23],
      up: [16, 21, 8, 13],
      down: [24, 13, 16, 21],
    },
    { transform }
  );
  return result.finish();
}

function conduit() {
  const result = builder();
  result.box("entity/conduit/base", [5, 5, 5], [11, 11, 11], cubeUv(6, 6, 6));
  return result.finish();
}

function enchantingTable(entry) {
  const result = builder();
  const table = resolveVanillaModel(entry);
  if (table?.supported) {
    result.faces.push(...table.faces);
  }
  const texture = "entity/enchantment/enchanting_table_book";
  const openness = 0.9;
  const degrees = (openness * 180) / Math.PI;
  // A fixed open pose from BookModel's native part dimensions. The world-space
  // tilt and height match the table renderer; no animation loop is needed.
  const pose =
    (yaw, offset = [0, 0, 0]) =>
    (point) => {
      const local = rotate(point, "y", yaw, [0, 0, 0]).map(
        (value, index) => value + offset[index]
      );
      const tilted = rotate(local, "z", 80, [0, 0, 0]);
      return [8 + tilted[0], 13.6 + tilted[1], 8 + tilted[2]];
    };
  result.box(texture, [-6, -5, -0.005], [0, 5, 0], cubeUv(6, 10, 0.005), {
    transform: pose(180 + degrees, [0, 0, -1]),
  });
  result.box(texture, [0, -5, -0.005], [6, 5, 0], cubeUv(6, 10, 0.005, 16, 0), {
    transform: pose(-degrees, [0, 0, 1]),
  });
  result.box(texture, [-1, -5, 0], [1, 5, 0.005], cubeUv(2, 10, 0.005, 12, 0), {
    transform: pose(90),
  });
  const pageOffset = [Math.sin(openness), 0, 0];
  result.box(texture, [0, -4, -0.99], [5, 4, 0.01], cubeUv(5, 8, 1, 0, 10), {
    transform: pose(degrees, pageOffset),
  });
  result.box(texture, [0, -4, -0.01], [5, 4, 0.99], cubeUv(5, 8, 1, 12, 10), {
    transform: pose(-degrees, pageOffset),
  });
  for (const angle of [-degrees / 3, degrees / 3]) {
    result.box(
      texture,
      [0, -4, 0],
      [5, 4, 0.005],
      cubeUv(5, 8, 0.005, 24, 10),
      { transform: pose(angle, pageOffset) }
    );
  }
  return result.finish();
}

function portal(id) {
  const result = builder();
  const texture = "entity/end_portal/end_portal";
  const tile = ATLAS.tiles[texture];
  if (!tile) {
    return {
      supported: false,
      reason: "texture",
      faces: [],
      occlusion: Array.from({ length: 6 }, () => []),
    };
  }
  const rect = [0, 0, tile.width, tile.height];
  const uv =
    id === "end_portal"
      ? { up: rect, down: rect }
      : Object.fromEntries(DIRECTIONS.map((direction) => [direction, rect]));
  result.box(
    texture,
    [0, id === "end_portal" ? 6 : 0, 0],
    [16, id === "end_portal" ? 12 : 16, 16],
    uv,
    { color: [0.3, 0.8, 0.7] }
  );
  for (const face of result.faces) {
    face.shade = false;
  }
  // Static original star texture, deliberately no animated portal shader.
  return result.finish();
}

export function resolveSpecialModel(entry, blockEntity = null) {
  const id = blockId(entry);
  if (!id) {
    return null;
  }
  const properties = entry.properties || {};
  const data = normalizeSpecialData(entry, blockEntity);
  const chestBlock =
    /^(?:chest|trapped_chest|ender_chest|(?:waxed_)?(?:(?:exposed|weathered|oxidized)_)?copper_chest)$/.test(
      id
    );
  const bannerBlock =
    /^(?:(?:white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_)?(?:wall_)?banner$/.test(
      id
    );
  const shulkerBlock =
    id === "shulker_box" || DYES.some((color) => id === `${color}_shulker_box`);
  const skullBlock = /_(?:head|skull)$/.test(id);
  const jsonBlock = /_(?:bed|sign|hanging_sign)$/.test(id);
  if (
    !(
      chestBlock ||
      bannerBlock ||
      shulkerBlock ||
      skullBlock ||
      jsonBlock ||
      [
        "decorated_pot",
        "bell",
        "conduit",
        "enchanting_table",
        "end_portal",
        "end_gateway",
      ].includes(id)
    )
  ) {
    return null;
  }
  if (jsonBlock) {
    return resolveVanillaModel(entry);
  }
  const key = JSON.stringify([
    id,
    properties.facing,
    properties.rotation,
    properties.type,
    properties.attachment,
    data,
  ]);
  if (MODEL_CACHE.has(key)) {
    return MODEL_CACHE.get(key);
  }
  let model;
  if (chestBlock) {
    model = chest(id, properties);
  } else if (bannerBlock) {
    model = banner(id, properties, data);
  } else if (shulkerBlock) {
    model = shulker(id, properties);
  } else if (skullBlock) {
    model = head(id, properties);
  } else if (id === "decorated_pot") {
    model = pot(properties, data);
  } else if (id === "bell") {
    model = bell(entry);
  } else if (id === "enchanting_table") {
    model = enchantingTable(entry);
  } else if (id === "end_portal" || id === "end_gateway") {
    model = portal(id);
  } else {
    model = conduit();
  }
  if (!model) {
    return null;
  }
  while (
    MODEL_CACHE.size &&
    (MODEL_CACHE.size >= MAX_CACHE_MODELS ||
      cachedFaceCount + model.faces.length > MAX_CACHE_FACES)
  ) {
    const first = MODEL_CACHE.keys().next().value;
    cachedFaceCount -= MODEL_CACHE.get(first).faces.length;
    MODEL_CACHE.delete(first);
  }
  MODEL_CACHE.set(key, model);
  cachedFaceCount += model.faces.length;
  return model;
}
