/* eslint-disable no-bitwise -- Integer hashing gives stable original block color variation. */
import { blockTextures } from "./block-textures.mjs";
import { createFluidFaces, fluidState } from "./fluids.mjs";
import { resolveSpecialModel, specialModelKey } from "./special-models.mjs";
import {
  resolveVanillaModel,
  vanillaModelSeedPeriod,
} from "./vanilla-models.mjs";

export const MAX_MESH_FACES = 200000;
export const MAX_MESH_MODELS = 8192;
export const MAX_TRANSLUCENT_FACES = 65536;
export const MAX_COMPILED_FACES = 200000;
const CHUNK_FACES = 2048;
const EPSILON = 1e-7;
const AIR = new Set(["air", "cave_air", "void_air"]);
const DIRECTIONS = ["north", "east", "south", "west"];
const AXES = [
  [1, 2],
  [0, 2],
  [0, 1],
];
const FALLBACK_TEXTURES = blockTextures("preview:fallback");
const DYES = {
  white: "e5e4df",
  orange: "d97827",
  magenta: "b94fb3",
  light_blue: "66a9ce",
  yellow: "e5c83f",
  lime: "7fac36",
  pink: "db8fa5",
  gray: "55565c",
  light_gray: "a4a69e",
  cyan: "327f91",
  purple: "79489c",
  blue: "3c539e",
  brown: "795338",
  green: "536a30",
  red: "aa3735",
  black: "27282c",
};
const WOODS = {
  dark_oak: "5b422d",
  pale_oak: "c7bda8",
  spruce: "796044",
  birch: "d0c18e",
  jungle: "a97b59",
  acacia: "ba7450",
  mangrove: "84443b",
  cherry: "d8a7a3",
  bamboo: "b9af64",
  crimson: "8d465e",
  warped: "397e78",
  oak: "ac8a54",
};

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  }
  return result >>> 0;
}

function positionHash(x, y, z) {
  return (
    (Math.imul(x, 73856093) ^
      Math.imul(y, 19349663) ^
      Math.imul(z, 83492791)) >>>
    0
  );
}

function linear(hex) {
  return [0, 2, 4].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
}

function fallbackColor(name) {
  const seed = hash(name);
  return [seed & 255, (seed >>> 8) & 255, (seed >>> 16) & 255].map(
    (value) => 0.12 + (value / 255) * 0.4
  );
}

function colorFor(name) {
  if (!name.startsWith("minecraft:")) {
    return fallbackColor(name);
  }
  const id = name.slice(10);
  for (const [dye, color] of Object.entries(DYES)) {
    if (id.startsWith(`${dye}_`)) {
      return linear(color);
    }
  }
  if (/glass/.test(id)) {
    return linear("a6c6ce");
  }
  if (/water|ice/.test(id)) {
    return linear("5196c6");
  }
  if (/lava|magma/.test(id)) {
    return linear("dc7531");
  }
  if (/leaves|grass|fern|moss|sapling|vine|cactus/.test(id)) {
    return linear("6d974d");
  }
  if (/dirt|mud|farmland|podzol|soul_sand/.test(id)) {
    return linear("886346");
  }
  if (/sandstone|sand/.test(id)) {
    return linear("d7c490");
  }
  if (/snow|quartz|calcite|bone/.test(id)) {
    return linear("e4e3db");
  }
  if (/deepslate|basalt|blackstone|coal/.test(id)) {
    return linear("45494c");
  }
  if (/netherrack|nether_brick/.test(id)) {
    return linear("754844");
  }
  if (/end_stone/.test(id)) {
    return linear("d8d6a2");
  }
  if (/copper/.test(id)) {
    return linear(/oxidized|weathered/.test(id) ? "568e7b" : "b47b58");
  }
  if (/gold/.test(id)) {
    return linear("d5b34d");
  }
  if (/diamond|prismarine/.test(id)) {
    return linear("65b5ad");
  }
  if (/emerald/.test(id)) {
    return linear("4c9e6b");
  }
  if (/lapis/.test(id)) {
    return linear("456fab");
  }
  if (/redstone/.test(id)) {
    return linear("9e3330");
  }
  if (/stone_brick/.test(id)) {
    return linear("90958f");
  }
  if (/brick|granite/.test(id)) {
    return linear("ad7b6a");
  }
  if (/iron/.test(id)) {
    return linear("b9bcb7");
  }
  for (const [wood, color] of Object.entries(WOODS)) {
    if (id.includes(wood)) {
      return linear(color);
    }
  }
  if (/chest|barrel|crafting|bookshelf/.test(id)) {
    return linear("aa8050");
  }
  if (/stone|andesite|cobble|furnace|dispenser|dropper|gravel|rail/.test(id)) {
    return linear("90958f");
  }
  return fallbackColor(name);
}

function box(bounds, color) {
  return { bounds, color };
}

function rotateBox(item, facing) {
  const turns = Math.max(0, DIRECTIONS.indexOf(facing));
  let [x0, y0, z0, x1, y1, z1] = item.bounds;
  for (let index = 0; index < turns; index++) {
    [x0, z0, x1, z1] = [1 - z1, x0, 1 - z0, x1];
  }
  return box([x0, y0, z0, x1, y1, z1], item.color);
}

function modelBoxes(id, properties, color) {
  const full = () => [box([0, 0, 0, 1, 1, 1])];
  if (id.endsWith("_slab")) {
    if (properties.type === "double") {
      return full();
    }
    return [
      box(
        properties.type === "top" ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1]
      ),
    ];
  }
  if (id.endsWith("_stairs")) {
    const shape = properties.shape || "straight";
    const boxes = [box([0, 0, 0, 1, 0.5, 1])];
    if (shape.startsWith("outer_")) {
      const left = shape.endsWith("left");
      boxes.push(box([left ? 0 : 0.5, 0.5, 0, left ? 0.5 : 1, 1, 0.5]));
    } else {
      boxes.push(box([0, 0.5, 0, 1, 1, 0.5]));
      if (shape.startsWith("inner_")) {
        const left = shape.endsWith("left");
        boxes.push(box([left ? 0 : 0.5, 0.5, 0.5, left ? 0.5 : 1, 1, 1]));
      }
    }
    return boxes.map((item) => {
      if (properties.half === "top") {
        const b = item.bounds;
        [b[1], b[4]] = [1 - b[4], 1 - b[1]];
      }
      return rotateBox(item, properties.facing);
    });
  }
  if (id.endsWith("_trapdoor")) {
    if (properties.open === "true") {
      return [rotateBox(box([0, 0, 0, 1, 1, 0.1875]), properties.facing)];
    }
    return [
      box(
        properties.half === "top"
          ? [0, 0.8125, 0, 1, 1, 1]
          : [0, 0, 0, 1, 0.1875, 1]
      ),
    ];
  }
  if (id.endsWith("_door")) {
    let facing = properties.facing || "north";
    if (properties.open === "true") {
      const turn = properties.hinge === "right" ? 3 : 1;
      facing = DIRECTIONS[(DIRECTIONS.indexOf(facing) + turn) % 4];
    }
    return [rotateBox(box([0, 0, 0, 1, 1, 0.1875]), facing)];
  }
  if (id.endsWith("_fence") || id.endsWith("_wall")) {
    const wall = id.endsWith("_wall");
    const boxes = [
      box(
        wall
          ? [0.25, 0, 0.25, 0.75, 1, 0.75]
          : [0.375, 0, 0.375, 0.625, 1, 0.625]
      ),
    ];
    for (const facing of DIRECTIONS) {
      const connected = properties[facing];
      if (connected && connected !== "false" && connected !== "none") {
        if (wall) {
          boxes.push(
            rotateBox(
              box([
                0.3125,
                0,
                0,
                0.6875,
                connected === "tall" ? 1 : 0.8125,
                0.5,
              ]),
              facing
            )
          );
        } else {
          for (const y of [0.375, 0.75]) {
            boxes.push(
              rotateBox(box([0.4375, y, 0, 0.5625, y + 0.1875, 0.5]), facing)
            );
          }
        }
      }
    }
    return boxes;
  }
  if (id.endsWith("_pane") || id === "iron_bars") {
    const boxes = [box([0.4375, 0, 0.4375, 0.5625, 1, 0.5625])];
    for (const facing of DIRECTIONS) {
      if (properties[facing] === "true") {
        boxes.push(rotateBox(box([0.4375, 0, 0, 0.5625, 1, 0.5]), facing));
      }
    }
    return boxes;
  }
  if (id.endsWith("_fence_gate")) {
    const boxes = [
      box([0, 0.25, 0.375, 0.125, 1, 0.625]),
      box([0.875, 0.25, 0.375, 1, 1, 0.625]),
    ];
    for (const y of [0.375, 0.75]) {
      if (properties.open === "true") {
        boxes.push(
          box([0, y, 0, 0.125, y + 0.1875, 0.5]),
          box([0.875, y, 0, 1, y + 0.1875, 0.5])
        );
      } else {
        boxes.push(box([0.125, y, 0.4375, 0.875, y + 0.1875, 0.5625]));
      }
    }
    return boxes.map((item) => rotateBox(item, properties.facing));
  }
  if (id.endsWith("rail")) {
    const boxes = [
      box([0.125, 0.03125, 0, 0.25, 0.09375, 1]),
      box([0.75, 0.03125, 0, 0.875, 0.09375, 1]),
    ];
    for (const z of [0.0625, 0.4375, 0.8125]) {
      boxes.push(box([0, 0, z, 1, 0.03125, z + 0.125], linear("795b3c")));
    }
    return boxes.map((item) =>
      rotateBox(
        item,
        /east|west/.test(properties.shape || "") ? "east" : "north"
      )
    );
  }
  if (id.endsWith("_carpet") || id === "moss_carpet") {
    return [box([0, 0, 0, 1, 0.0625, 1])];
  }
  if (id === "snow") {
    return [
      box([
        0,
        0,
        0,
        1,
        Math.max(1, Math.min(8, Number(properties.layers) || 1)) / 8,
        1,
      ]),
    ];
  }
  if (id === "farmland" || id.endsWith("_path")) {
    return [box([0, 0, 0, 1, 0.9375, 1])];
  }
  if (id.endsWith("torch")) {
    return [
      box([0.4375, 0, 0.4375, 0.5625, 0.625, 0.5625], linear("947044")),
      box(
        [0.40625, 0.5, 0.40625, 0.59375, 0.75, 0.59375],
        linear(id.includes("soul") ? "70cbce" : "efb644")
      ),
    ];
  }
  if (id.includes("chest")) {
    return [
      rotateBox(
        box([0.0625, 0, 0.0625, 0.9375, 0.875, 0.9375]),
        properties.facing
      ),
      rotateBox(
        box([0.4375, 0.3125, 0, 0.5625, 0.5625, 0.0625], linear("d2b354")),
        properties.facing
      ),
    ];
  }
  if (id.endsWith("_bed")) {
    const boxes = [box([0, 0.1875, 0, 1, 0.5625, 1])];
    if (properties.part === "head") {
      boxes.push(
        box([0.0625, 0.5625, 0.0625, 0.9375, 0.625, 0.375], linear("e9e6db"))
      );
    }
    return boxes.map((item) => rotateBox(item, properties.facing));
  }
  if (id === "redstone_wire") {
    return [box([0, 0, 0, 1, 0.03125, 1])];
  }
  if (id === "repeater" || id === "comparator") {
    return [
      box([0, 0, 0, 1, 0.125, 1], linear("a5a39e")),
      box([0.1875, 0.125, 0.25, 0.3125, 0.4375, 0.375], linear("b4463b")),
      box([0.6875, 0.125, 0.25, 0.8125, 0.4375, 0.375], linear("b4463b")),
    ].map((item) => rotateBox(item, properties.facing));
  }
  if (
    /sapling|flower|tulip|fern|short_grass|tall_grass|dead_bush|poppy|dandelion|bamboo$/.test(
      id
    )
  ) {
    return [
      box([0.46875, 0, 0.125, 0.53125, 0.8125, 0.875], color),
      box([0.125, 0, 0.46875, 0.875, 0.8125, 0.53125], color),
    ];
  }
  return full();
}

// Remove an axis-aligned coverage rectangle without generating overlapping faces.
function subtract(rect, cover) {
  const [u0, v0, u1, v1] = rect;
  const a = Math.max(u0, cover[0]);
  const b = Math.max(v0, cover[1]);
  const c = Math.min(u1, cover[2]);
  const d = Math.min(v1, cover[3]);
  if (a >= c - EPSILON || b >= d - EPSILON) {
    return [rect];
  }
  const result = [];
  if (u0 < a - EPSILON) {
    result.push([u0, v0, a, v1]);
  }
  if (c < u1 - EPSILON) {
    result.push([c, v0, u1, v1]);
  }
  if (v0 < b - EPSILON) {
    result.push([a, v0, c, b]);
  }
  if (d < v1 - EPSILON) {
    result.push([a, d, c, v1]);
  }
  return result;
}

function faceColor(id, properties, color, axis, sign) {
  if (id === "grass_block") {
    return linear(
      axis === 1 && sign > 0 ? "77a84b" : axis === 1 ? "785639" : "98734b"
    );
  }
  if (/_log$|_wood$|_stem$|_hyphae$/.test(id)) {
    const grainAxis = { x: 0, y: 1, z: 2 }[properties.axis || "y"];
    return color.map((value) =>
      Math.min(1, value * (axis === grainAxis ? 1.2 : 0.66))
    );
  }
  return color;
}

function compileFallback(entry) {
  const name = typeof entry === "string" ? entry : entry.name;
  const id = (name || "unknown").split(":").pop();
  if (name?.startsWith("minecraft:") && AIR.has(id)) {
    return null;
  }
  const properties = entry.properties || {};
  const color = colorFor(name || "unknown");
  const textures = blockTextures(entry);
  const boxes = modelBoxes(id, properties, color);
  const faces = [];
  for (let index = 0; index < boxes.length; index++) {
    const item = boxes[index];
    const bounds = item.bounds;
    for (let axis = 0; axis < 3; axis++) {
      const [u, v] = AXES[axis];
      for (const sign of [-1, 1]) {
        const plane = bounds[axis + (sign > 0 ? 3 : 0)];
        let rectangles = [[bounds[u], bounds[v], bounds[u + 3], bounds[v + 3]]];
        for (
          let other = 0;
          other < boxes.length && rectangles.length;
          other++
        ) {
          if (other === index) {
            continue;
          }
          const cover = boxes[other].bounds;
          const coversPlane =
            sign > 0
              ? cover[axis] <= plane + EPSILON &&
                cover[axis + 3] > plane + EPSILON
              : cover[axis + 3] >= plane - EPSILON &&
                cover[axis] < plane - EPSILON;
          if (coversPlane) {
            rectangles = rectangles.flatMap((rect) =>
              subtract(rect, [cover[u], cover[v], cover[u + 3], cover[v + 3]])
            );
          }
        }
        const texture = (item.color ? FALLBACK_TEXTURES : textures)[
          axis * 2 + (sign > 0 ? 1 : 0)
        ];
        for (const rect of rectangles) {
          faces.push({
            axis,
            sign,
            plane,
            rect,
            boundary: plane === (sign > 0 ? 1 : 0),
            uv: texture.uv,
            color: texture.textured
              ? texture.tint
              : item.color || faceColor(id, properties, color, axis, sign),
          });
        }
      }
    }
  }
  return {
    boxes,
    faces,
    occludes: !textures.some((texture) => texture.cutout),
    full:
      boxes.length === 1 &&
      boxes[0].bounds.every((value, index) => value === (index < 3 ? 0 : 1)),
  };
}

function rectangleProjection(face) {
  if (face.cullface < 0) {
    return null;
  }
  const axis = Math.floor(face.cullface / 2);
  const plane = face.cullface % 2;
  const [u, v] = AXES[axis];
  const points = [0, 3, 6, 9];
  if (
    points.some(
      (offset) => Math.abs(face.vertices[offset + axis] - plane) > EPSILON
    )
  ) {
    return null;
  }
  const rect = [
    Math.min(...points.map((offset) => face.vertices[offset + u])),
    Math.min(...points.map((offset) => face.vertices[offset + v])),
    Math.max(...points.map((offset) => face.vertices[offset + u])),
    Math.max(...points.map((offset) => face.vertices[offset + v])),
  ];
  const rectangular = points.every((offset) =>
    [u, v].every(
      (coordinate, index) =>
        Math.abs(face.vertices[offset + coordinate] - rect[index]) < EPSILON ||
        Math.abs(face.vertices[offset + coordinate] - rect[index + 2]) < EPSILON
    )
  );
  return { axis, plane, u, v, rect, rectangular };
}

function boundaryCoverage(faces) {
  const result = Array.from({ length: 6 }, () => []);
  for (const face of faces) {
    const projection = rectangleProjection(face);
    if (projection?.rectangular) {
      result[face.cullface].push(projection.rect);
    }
  }
  return result;
}

function fallbackQuad(face) {
  const [u, v] = AXES[face.axis];
  const corners = [
    [face.rect[0], face.rect[1]],
    [face.rect[2], face.rect[1]],
    [face.rect[2], face.rect[3]],
    [face.rect[0], face.rect[3]],
  ];
  const order = (face.axis === 1 ? face.sign < 0 : face.sign > 0)
    ? [0, 1, 2, 3]
    : [0, 3, 2, 1];
  const vertices = [];
  const uvs = [];
  for (const index of order) {
    const [a, b] = corners[index];
    const point = [0, 0, 0];
    point[face.axis] = face.plane;
    point[u] = a;
    point[v] = b;
    vertices.push(...point);
    uvs.push(
      face.uv[0] * a + face.uv[1] * b + face.uv[2],
      face.uv[3] * a + face.uv[4] * b + face.uv[5]
    );
  }
  const normal = [0, 0, 0];
  normal[face.axis] = face.sign;
  return {
    vertices,
    uvs,
    normal,
    tint: face.color,
    layer: "opaque",
    shade: true,
    cullface: face.boundary ? face.axis * 2 + (face.sign > 0 ? 1 : 0) : -1,
  };
}

function compileModel(entry, seed = 0, blockEntity = null) {
  const name = typeof entry === "string" ? entry : entry.name;
  if (name?.startsWith("minecraft:") && AIR.has(name.slice(10))) {
    return null;
  }
  const fluid = fluidState(entry);
  let faces = [];
  let occlusion = Array.from({ length: 6 }, () => []);
  let fallback = false;
  if (!fluid || fluid.waterlogged) {
    const resolved =
      resolveSpecialModel(entry, blockEntity) ||
      resolveVanillaModel(entry, seed);
    if (resolved?.supported && resolved.faces) {
      faces = resolved.faces;
      occlusion = resolved.occlusion || occlusion;
    } else {
      const approximate = compileFallback(entry);
      faces = approximate.faces.map(fallbackQuad);
      if (approximate.occludes) {
        occlusion = boundaryCoverage(faces);
      }
      fallback = true;
    }
  }
  const coverage = boundaryCoverage(faces);
  faces = faces.map((face) => ({
    ...face,
    projection: rectangleProjection(face),
  }));
  // Fluid occupancy is independent of visual opacity: full glass/leaves hold
  // the shoreline while their textures still reveal neighboring surfaces.
  const solid = coverage.every((rectangles) =>
    rectangles.some(
      ([u0, v0, u1, v1]) =>
        u0 <= EPSILON && v0 <= EPSILON && u1 >= 1 - EPSILON && v1 >= 1 - EPSILON
    )
  );
  return {
    name,
    fluid,
    faces,
    occlusion,
    coverage,
    solid,
    fallback,
    sameGlass:
      name?.startsWith("minecraft:") &&
      /(?:^|_)glass(?:_pane)?$/.test(name.slice(10)),
  };
}

function clipQuad(face, covers) {
  if (!covers?.length) {
    return [face];
  }
  const projection = face.projection || rectangleProjection(face);
  if (!projection) {
    return [face];
  }
  const source = projection.rect;
  if (
    covers.some(
      ([u0, v0, u1, v1]) =>
        u0 <= source[0] + EPSILON &&
        v0 <= source[1] + EPSILON &&
        u1 >= source[2] - EPSILON &&
        v1 >= source[3] - EPSILON
    )
  ) {
    return [];
  }
  // A sloped/rotated polygon must not be replaced with its bounding box.
  if (!projection.rectangular) {
    return [face];
  }
  let rectangles = [source];
  for (const cover of covers) {
    rectangles = rectangles.flatMap((rect) => subtract(rect, cover));
  }
  if (rectangles.length === 1 && rectangles[0] === source) {
    return [face];
  }
  const { u, v } = projection;
  const width = source[2] - source[0];
  const height = source[3] - source[1];
  if (width < EPSILON || height < EPSILON) {
    return [face];
  }
  return rectangles.map((rect) => {
    const vertices = [...face.vertices];
    const uvs = [];
    for (let corner = 0; corner < 4; corner++) {
      const offset = corner * 3;
      const a =
        rect[Math.abs(face.vertices[offset + u] - source[0]) < EPSILON ? 0 : 2];
      const b =
        rect[Math.abs(face.vertices[offset + v] - source[1]) < EPSILON ? 1 : 3];
      vertices[offset + u] = a;
      vertices[offset + v] = b;
      const s = (a - source[0]) / width;
      const t = (b - source[1]) / height;
      const texcoord = [0, 0];
      for (let original = 0; original < 4; original++) {
        const weight =
          (Math.abs(face.vertices[original * 3 + u] - source[0]) < EPSILON
            ? 1 - s
            : s) *
          (Math.abs(face.vertices[original * 3 + v] - source[1]) < EPSILON
            ? 1 - t
            : t);
        texcoord[0] += face.uvs[original * 2] * weight;
        texcoord[1] += face.uvs[original * 2 + 1] * weight;
      }
      uvs.push(...texcoord);
    }
    return { ...face, vertices, uvs, projection: null };
  });
}

class MeshWriter {
  constructor() {
    this.layers = [
      { chunks: [], faceCount: 0 },
      { chunks: [], faceCount: 0 },
    ];
    this.faceCount = 0;
  }

  face(face, x, y, z, variation) {
    const translucent = face.layer === "translucent";
    const layer = this.layers[translucent ? 1 : 0];
    if (
      this.faceCount >= MAX_MESH_FACES ||
      (translucent && layer.faceCount >= MAX_TRANSLUCENT_FACES)
    ) {
      const error = new Error(
        "The schematic has too many visible faces to preview."
      );
      error.category = "too_complex";
      throw error;
    }
    const slot = layer.faceCount % CHUNK_FACES;
    if (slot === 0) {
      layer.chunks.push({
        positions: new Float32Array(CHUNK_FACES * 18),
        normals: new Float32Array(CHUNK_FACES * 18),
        colors: new Float32Array(CHUNK_FACES * 18),
        uvs: new Float32Array(CHUNK_FACES * 12),
      });
    }
    const chunk = layer.chunks[layer.chunks.length - 1];
    const origin = [x, y, z];
    const normal = face.shadeNormal || face.normal;
    const shade =
      (face.shade === false
        ? 1
        : normal[0] ** 2 * 0.87 +
          normal[1] ** 2 * (normal[1] >= 0 ? 1 : 0.72) +
          normal[2] ** 2 * 0.94) * variation;
    let offset = slot * 18;
    let uvOffset = slot * 12;
    const order = [0, 1, 2, 0, 2, 3];
    for (let vertex = 0; vertex < order.length; vertex++) {
      const corner = order[vertex];
      let surfaceNormal = face.normal;
      if (face.fluid && face.cullface === 3) {
        const start = vertex < 3 ? 0 : 3;
        const a = [0, 1, 2].map(
          (axis) =>
            face.vertices[order[start + 1] * 3 + axis] -
            face.vertices[order[start] * 3 + axis]
        );
        const b = [0, 1, 2].map(
          (axis) =>
            face.vertices[order[start + 2] * 3 + axis] -
            face.vertices[order[start] * 3 + axis]
        );
        surfaceNormal = [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ];
        const magnitude = Math.hypot(...surfaceNormal) || 1;
        surfaceNormal = surfaceNormal.map((value) => value / magnitude);
      }
      chunk.uvs[uvOffset++] = face.uvs[corner * 2];
      chunk.uvs[uvOffset++] = face.uvs[corner * 2 + 1];
      for (let axis = 0; axis < 3; axis++) {
        chunk.positions[offset] =
          origin[axis] + face.vertices[corner * 3 + axis];
        chunk.normals[offset] = surfaceNormal[axis];
        chunk.colors[offset] = Math.min(1, face.tint[axis] * shade);
        offset++;
      }
    }
    this.faceCount++;
    layer.faceCount++;
  }

  finish() {
    const length = this.faceCount * 18;
    const result = {
      positions: new Float32Array(length),
      normals: new Float32Array(length),
      colors: new Float32Array(length),
      uvs: new Float32Array(this.faceCount * 12),
      faceCount: this.faceCount,
      opaqueFaceCount: this.layers[0].faceCount,
      translucentFaceCount: this.layers[1].faceCount,
    };
    let offset = 0;
    for (const layer of this.layers) {
      let remaining = layer.faceCount * 18;
      for (const chunk of layer.chunks) {
        const count = Math.min(CHUNK_FACES * 18, remaining);
        for (const key of ["positions", "normals", "colors"]) {
          result[key].set(chunk[key].subarray(0, count), offset);
        }
        result.uvs.set(
          chunk.uvs.subarray(0, (count / 18) * 12),
          (offset / 18) * 12
        );
        offset += count;
        remaining -= count;
      }
      layer.chunks = [];
    }
    return result;
  }
}

/** Bundled vanilla models with explicit fallback. cutY is inclusive world Y; output is relative
 * to scene.bounds.min so even distant regions retain Float32 block precision. */
export function buildMesh(scene, cutY = Infinity) {
  const origin = scene.bounds?.min || [0, 0, 0];
  const regions = scene.regions.map((region) => ({
    ...region,
    models: new Map(),
    decorations: new Map(),
    max: region.position.map((value, axis) => value + region.size[axis]),
  }));
  let modelCount = 0;
  let variantCount = 0;
  let compiledFaceCount = 0;
  const compiledStates = new Map();
  const modelFor = (region, index, x, y, z) => {
    let state = region.models.get(index);
    if (!state) {
      const entry = region.palette[index];
      const properties = entry.properties || {};
      const name = typeof entry === "string" ? entry : entry.name;
      const key = JSON.stringify([
        name,
        Object.keys(properties)
          .sort()
          .map((property) => [property, properties[property]]),
      ]);
      state = compiledStates.get(key);
      if (!state) {
        if (
          !(name?.startsWith("minecraft:") && AIR.has(name.slice(10))) &&
          ++modelCount > MAX_MESH_MODELS
        ) {
          const error = new Error(
            "The schematic has too many distinct block models to preview."
          );
          error.category = "too_complex";
          throw error;
        }
        state = {
          entry,
          period: vanillaModelSeedPeriod(entry),
          variants: new Map(),
        };
        compiledStates.set(key, state);
      }
      region.models.set(index, state);
    }
    const seed = state.period === 1 ? 0 : positionHash(x, y, z) % state.period;
    let blockEntity;
    let decoration = "";
    if (region.blockEntities?.size) {
      const cell =
        x -
        region.position[0] +
        region.size[0] *
          (z - region.position[2] + region.size[2] * (y - region.position[1]));
      blockEntity = region.blockEntities.get(cell);
      if (blockEntity) {
        // Neighbor face queries reuse the same canonical decoration key.
        // The sparse map is bounded by the parser's block-entity budget.
        decoration = region.decorations.get(cell);
        if (decoration === undefined) {
          decoration = specialModelKey(state.entry, blockEntity);
          region.decorations.set(cell, decoration);
        }
      }
    }
    const variant = decoration ? `${seed}:${decoration}` : seed;
    if (!state.variants.has(variant)) {
      const model = compileModel(state.entry, seed, blockEntity);
      if (model && ++variantCount > MAX_MESH_MODELS) {
        const error = new Error(
          "The schematic has too many decorated model variants to preview."
        );
        error.category = "too_complex";
        throw error;
      }
      compiledFaceCount += model?.faces.length || 0;
      if (compiledFaceCount > MAX_COMPILED_FACES) {
        const error = new Error(
          "The schematic has too many distinct model faces to preview."
        );
        error.category = "too_complex";
        throw error;
      }
      state.variants.set(variant, model);
    }
    return state.variants.get(variant);
  };
  // Only region-boundary lookups can cross this short adjacency list. No
  // per-cell map, string keys, or copy of the decoded block volume is needed.
  const adjacent = regions.map((region, index) =>
    regions.filter(
      (other, otherIndex) =>
        index !== otherIndex &&
        region.position.every(
          (value, axis) =>
            value <= other.max[axis] && region.max[axis] >= other.position[axis]
        )
    )
  );
  const modelAt = (region, x, y, z) => {
    const [ox, oy, oz] = region.position;
    const [sx, sy, sz] = region.size;
    x -= ox;
    y -= oy;
    z -= oz;
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) {
      return null;
    }
    return modelFor(
      region,
      region.blocks[x + sx * (z + sz * y)],
      x + ox,
      y + oy,
      z + oz
    );
  };
  const writer = new MeshWriter();
  let fallbackBlockCount = 0;
  const unsupportedNames = new Set();
  for (let regionIndex = 0; regionIndex < regions.length; regionIndex++) {
    const region = regions[regionIndex];
    const [sx, sy, sz] = region.size;
    const [ox, oy, oz] = region.position;
    const neighbor = (x, y, z) => {
      if (y > cutY) {
        return null;
      }
      const own = modelAt(region, x, y, z);
      if (own) {
        return own;
      }
      for (const other of adjacent[regionIndex]) {
        const found = modelAt(other, x, y, z);
        if (found) {
          return found;
        }
      }
      return null;
    };
    for (let ly = 0; ly < sy && oy + ly <= cutY; ly++) {
      const y = oy + ly;
      for (let lz = 0; lz < sz; lz++) {
        const z = oz + lz;
        for (let lx = 0; lx < sx; lx++) {
          const x = ox + lx;
          const model = modelFor(
            region,
            region.blocks[lx + sx * (lz + sz * ly)],
            x,
            y,
            z
          );
          if (!model) {
            continue;
          }
          if (model.fallback) {
            fallbackBlockCount++;
            if (unsupportedNames.size < 20) {
              unsupportedNames.add(model.name);
            }
          }
          const variation = 0.97 + (positionHash(x, y, z) % 61) / 1000;
          const neighbors = [
            neighbor(x - 1, y, z),
            neighbor(x + 1, y, z),
            neighbor(x, y - 1, z),
            neighbor(x, y + 1, z),
            neighbor(x, y, z - 1),
            neighbor(x, y, z + 1),
          ];
          const emit = (face) => {
            const direction = face.cullface;
            const other = direction >= 0 ? neighbors[direction] : null;
            const opposite = direction % 2 ? direction - 1 : direction + 1;
            let quads = [face];
            if (face.fluid && model.fluid.waterlogged && direction >= 0) {
              quads = clipQuad(face, model.occlusion[direction]);
            }
            if (other) {
              const covers =
                model.sameGlass && other.name === model.name
                  ? other.coverage[opposite]
                  : other.occlusion[opposite];
              quads = quads.flatMap((quad) => clipQuad(quad, covers));
            }
            for (const quad of quads) {
              writer.face(
                quad,
                x - origin[0],
                y - origin[1],
                z - origin[2],
                variation
              );
            }
          };
          model.faces.forEach(emit);
          if (model.fluid) {
            const fluidFaces = createFluidFaces(model.fluid, (dx, dy, dz) =>
              dx === 0 && dy === 0 && dz === 0
                ? model
                : neighbor(x + dx, y + dy, z + dz)
            );
            fluidFaces.forEach(emit);
          }
        }
      }
    }
  }
  return {
    ...writer.finish(),
    fallbackBlockCount,
    unsupportedNames: [...unsupportedNames].sort(),
  };
}
