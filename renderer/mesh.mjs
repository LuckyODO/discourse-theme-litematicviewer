/* eslint-disable no-bitwise -- Integer hashing gives stable original block color variation. */

export const MAX_MESH_FACES = 200000;
export const MAX_MESH_MODELS = 8192;
const CHUNK_FACES = 2048;
const EPSILON = 1e-7;
const AIR = new Set(["air", "cave_air", "void_air"]);
const DIRECTIONS = ["north", "east", "south", "west"];
const AXES = [
  [1, 2],
  [0, 2],
  [0, 1],
];
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

function compileModel(entry) {
  const name = typeof entry === "string" ? entry : entry.name;
  const id = (name || "unknown").split(":").pop();
  if (name?.startsWith("minecraft:") && AIR.has(id)) {
    return null;
  }
  const properties = entry.properties || {};
  const color = colorFor(name || "unknown");
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
        for (const rect of rectangles) {
          faces.push({
            axis,
            sign,
            plane,
            rect,
            boundary: plane === (sign > 0 ? 1 : 0),
            color: item.color || faceColor(id, properties, color, axis, sign),
          });
        }
      }
    }
  }
  return {
    boxes,
    faces,
    full:
      boxes.length === 1 &&
      boxes[0].bounds.every((value, index) => value === (index < 3 ? 0 : 1)),
  };
}

class MeshWriter {
  constructor() {
    this.chunks = [];
    this.faceCount = 0;
  }

  face(face, rect, x, y, z, variation) {
    if (this.faceCount >= MAX_MESH_FACES) {
      const error = new Error(
        "The schematic has too many visible faces to preview."
      );
      error.category = "too_complex";
      throw error;
    }
    const slot = this.faceCount % CHUNK_FACES;
    if (slot === 0) {
      this.chunks.push({
        positions: new Float32Array(CHUNK_FACES * 18),
        normals: new Float32Array(CHUNK_FACES * 18),
        colors: new Float32Array(CHUNK_FACES * 18),
      });
    }
    const chunk = this.chunks[this.chunks.length - 1];
    const [u] = AXES[face.axis];
    const origin = [x, y, z];
    const corners = [
      [rect[0], rect[1]],
      [rect[2], rect[1]],
      [rect[2], rect[3]],
      [rect[0], rect[3]],
    ];
    const winding = (face.axis === 1 ? face.sign < 0 : face.sign > 0)
      ? [0, 1, 2, 0, 2, 3]
      : [0, 2, 1, 0, 3, 2];
    const shade =
      (face.axis === 1
        ? face.sign > 0
          ? 1
          : 0.72
        : face.axis === 0
          ? 0.87
          : 0.94) * variation;
    let offset = slot * 18;
    for (const corner of winding) {
      for (let axis = 0; axis < 3; axis++) {
        const coordinate =
          axis === face.axis ? face.plane : corners[corner][axis === u ? 0 : 1];
        chunk.positions[offset] = origin[axis] + coordinate;
        chunk.normals[offset] = axis === face.axis ? face.sign : 0;
        chunk.colors[offset] = Math.min(1, face.color[axis] * shade);
        offset++;
      }
    }
    this.faceCount++;
  }

  finish() {
    const length = this.faceCount * 18;
    const result = {
      positions: new Float32Array(length),
      normals: new Float32Array(length),
      colors: new Float32Array(length),
      faceCount: this.faceCount,
    };
    let offset = 0;
    for (const chunk of this.chunks) {
      const count = Math.min(CHUNK_FACES * 18, length - offset);
      for (const key of ["positions", "normals", "colors"]) {
        result[key].set(chunk[key].subarray(0, count), offset);
      }
      offset += count;
    }
    this.chunks = [];
    return result;
  }
}

/** Original approximate models. cutY is inclusive world Y; output is relative
 * to scene.bounds.min so even distant regions retain Float32 block precision. */
export function buildMesh(scene, cutY = Infinity) {
  const origin = scene.bounds?.min || [0, 0, 0];
  const regions = scene.regions.map((region) => ({
    ...region,
    models: new Map(),
    max: region.position.map((value, axis) => value + region.size[axis]),
  }));
  let modelCount = 0;
  const compiledModels = new Map();
  const modelFor = (region, index) => {
    if (region.models.has(index)) {
      return region.models.get(index);
    }
    const entry = region.palette[index];
    const properties = entry.properties || {};
    const key = JSON.stringify([
      typeof entry === "string" ? entry : entry.name,
      Object.keys(properties)
        .sort()
        .map((name) => [name, properties[name]]),
    ]);
    let model;
    if (compiledModels.has(key)) {
      model = compiledModels.get(key);
    } else {
      model = compileModel(entry);
      if (model && ++modelCount > MAX_MESH_MODELS) {
        const error = new Error(
          "The schematic has too many distinct block models to preview."
        );
        error.category = "too_complex";
        throw error;
      }
      compiledModels.set(key, model);
    }
    region.models.set(index, model);
    return model;
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
    return modelFor(region, region.blocks[x + sx * (z + sz * y)]);
  };
  const writer = new MeshWriter();
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
          const model = modelFor(
            region,
            region.blocks[lx + sx * (lz + sz * ly)]
          );
          if (!model) {
            continue;
          }
          const x = ox + lx;
          const variation =
            0.97 +
            (((Math.imul(x, 73856093) ^
              Math.imul(y, 19349663) ^
              Math.imul(z, 83492791)) >>>
              0) %
              61) /
              1000;
          const neighbors = [
            neighbor(x - 1, y, z),
            neighbor(x + 1, y, z),
            neighbor(x, y - 1, z),
            neighbor(x, y + 1, z),
            neighbor(x, y, z - 1),
            neighbor(x, y, z + 1),
          ];
          for (const face of model.faces) {
            let rectangles = [face.rect];
            const other = face.boundary
              ? neighbors[face.axis * 2 + (face.sign > 0 ? 1 : 0)]
              : null;
            if (other?.full) {
              continue;
            }
            if (other) {
              const [u, v] = AXES[face.axis];
              for (const item of other.boxes) {
                const bounds = item.bounds;
                if (
                  bounds[face.axis + (face.sign > 0 ? 0 : 3)] ===
                  (face.sign > 0 ? 0 : 1)
                ) {
                  rectangles = rectangles.flatMap((rect) =>
                    subtract(rect, [
                      bounds[u],
                      bounds[v],
                      bounds[u + 3],
                      bounds[v + 3],
                    ])
                  );
                }
              }
            }
            for (const rect of rectangles) {
              writer.face(
                face,
                rect,
                x - origin[0],
                y - origin[1],
                z - origin[2],
                variation
              );
            }
          }
        }
      }
    }
  }
  return writer.finish();
}
