import { BLOCK_MODELS } from "./generated/block-models.mjs";
import { ATLAS } from "./generated/texture-atlas.mjs";

const DIRECTIONS = ["west", "east", "down", "up", "north", "south"];
const NORMALS = [
  [-1, 0, 0],
  [1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
];
const PROJECTION_AXES = [
  [1, 2],
  [0, 2],
  [0, 1],
];
const EPSILON = 1e-7;
const MAX_CACHED_FACES = 65_536;
const MAX_CACHED_MODELS = 2048;
const WHITE = [1, 1, 1];
const DEFAULTS = {
  facing: "north",
  axis: "y",
  half: "bottom",
  type: "bottom",
  shape: "straight",
  hinge: "left",
  face: "floor",
  part: "foot",
  age: "0",
  level: "0",
  power: "0",
  layers: "1",
  segment_amount: "1",
  up: "true",
  north: "false",
  south: "false",
  east: "false",
  west: "false",
};

function linear(rgb) {
  return rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
}

function tintFor(id, properties) {
  if (id === "redstone_wire") {
    const power = Math.min(15, Math.max(0, Number(properties.power) || 0)) / 15;
    return linear([
      255 * (power * 0.6 + (power > 0 ? 0.4 : 0.3)),
      255 * Math.max(0, power * power * 0.7 - 0.5),
      255 * Math.max(0, power * power * 0.6 - 0.7),
    ]);
  }
  if (id === "birch_leaves") {
    return linear([128, 167, 85]);
  }
  if (id === "spruce_leaves") {
    return linear([97, 153, 97]);
  }
  if (id.endsWith("_leaves") || id === "vine") {
    return linear([119, 171, 47]);
  }
  if (id === "lily_pad") {
    return linear([32, 128, 48]);
  }
  if (/^(attached_)?(melon|pumpkin)_stem$/.test(id)) {
    const age = id.startsWith("attached_")
      ? 7
      : Math.min(7, Math.max(0, Number(properties.age) || 0));
    return linear([age * 32, 255 - age * 8, age * 4]);
  }
  if (/grass|fern|potted_fern|sugar_cane/.test(id)) {
    return linear([145, 189, 89]);
  }
  return WHITE;
}

function valueMatches(expected, actual) {
  const negate = expected.startsWith("!");
  const alternatives = (negate ? expected.slice(1) : expected).split("|");
  return alternatives.includes(String(actual)) !== negate;
}

export function modelConditionMatches(condition, properties) {
  if (!condition) {
    return true;
  }
  return Object.entries(condition).every(([key, expected]) => {
    if (key === "OR") {
      return expected.some((part) => modelConditionMatches(part, properties));
    }
    if (key === "AND") {
      return expected.every((part) => modelConditionMatches(part, properties));
    }
    let actual = properties[key];
    if (actual === undefined) {
      actual = DEFAULTS[key] ?? "false";
      if (actual === "false" && expected.split("|").includes("none")) {
        actual = "none";
      }
    }
    return valueMatches(expected, actual);
  });
}

function chooseWeighted(placements, seed) {
  if (!Array.isArray(placements)) {
    return placements;
  }
  const total = placements.reduce((sum, item) => sum + (item.weight || 1), 0);
  let choice = ((Math.trunc(seed) % total) + total) % total;
  for (const item of placements) {
    choice -= item.weight || 1;
    if (choice < 0) {
      return item;
    }
  }
  return placements[0];
}

function placementChoicesFor(state, properties) {
  if (state.multipart) {
    return state.multipart
      .filter((part) => modelConditionMatches(part.when, properties))
      .map((part) => part.apply);
  }
  let selected = null;
  let best = -Infinity;
  for (const [key, apply] of state.variants) {
    const constraints = key
      ? key.split(",").map((pair) => pair.split("="))
      : [];
    let score = 0;
    let matches = true;
    for (const [name, expected] of constraints) {
      if (properties[name] !== undefined) {
        if (!valueMatches(expected, properties[name])) {
          matches = false;
          break;
        }
        score += 2;
      } else if (valueMatches(expected, DEFAULTS[name] ?? "false")) {
        score++;
      }
    }
    if (matches && score > best) {
      selected = apply;
      best = score;
    }
  }
  return selected ? [selected] : [];
}

function choicePeriod(choices) {
  let period = 1;
  for (const choice of choices) {
    const total =
      Array.isArray(choice) && choice.length > 1
        ? choice.reduce((sum, placement) => sum + (placement.weight || 1), 0)
        : 1;
    let a = period;
    let b = total;
    while (b) {
      [a, b] = [b, a % b];
    }
    period = (period / a) * total;
    if (!Number.isSafeInteger(period) || period > 4096) {
      const error = new Error(
        "Model variant combinations exceed the preview limit."
      );
      error.category = "too_complex";
      throw error;
    }
  }
  return period;
}

function rotateAxis(point, axis, angle) {
  const radians = (angle * Math.PI) / 180;
  const sine = Math.sin(radians);
  const cosine = Math.cos(radians);
  const [x, y, z] = point;
  if (axis === "x") {
    return [x, y * cosine - z * sine, y * sine + z * cosine];
  }
  if (axis === "y") {
    return [x * cosine + z * sine, y, -x * sine + z * cosine];
  }
  return [x * cosine - y * sine, x * sine + y * cosine, z];
}

function rotateElement(point, rotation) {
  if (!rotation) {
    return point;
  }
  const origin = rotation.origin.map((value) => value / 16);
  let relative = point.map((value, index) => value - origin[index]);
  if (rotation.axis) {
    relative = rotateAxis(relative, rotation.axis, rotation.angle);
    if (rotation.rescale) {
      const factor = 1 / Math.cos((rotation.angle * Math.PI) / 180);
      const axis = "xyz".indexOf(rotation.axis);
      relative = relative.map((value, index) =>
        index === axis ? value : value * factor
      );
    }
  } else {
    // The resource format applies element rotations in X, then Y, then Z order.
    for (const axis of ["x", "y", "z"]) {
      relative = rotateAxis(relative, axis, rotation[axis] || 0);
    }
  }
  return relative.map((value, index) => value + origin[index]);
}

function rotatePlacement(point, placement, centered = true) {
  let result = centered ? point.map((value) => value - 0.5) : point;
  result = rotateAxis(result, "x", -(placement.x || 0));
  result = rotateAxis(result, "y", -(placement.y || 0));
  result = rotateAxis(result, "z", -(placement.z || 0));
  return centered ? result.map((value) => value + 0.5) : result;
}

function faceVertices(from, to, face) {
  const [x0, y0, z0] = from.map((value) => value / 16);
  const [x1, y1, z1] = to.map((value) => value / 16);
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
  ][face];
}

function defaultUv(from, to, face) {
  return [
    [from[2], 16 - to[1], to[2], 16 - from[1]],
    [16 - to[2], 16 - to[1], 16 - from[2], 16 - from[1]],
    [from[0], 16 - to[2], to[0], 16 - from[2]],
    [from[0], from[2], to[0], to[2]],
    [16 - to[0], 16 - to[1], 16 - from[0], 16 - from[1]],
    [from[0], 16 - to[1], to[0], 16 - from[1]],
  ][face];
}

function normalFor(vertices) {
  const a = vertices[1].map((value, index) => value - vertices[0][index]);
  const b = vertices[2].map((value, index) => value - vertices[0][index]);
  const normal = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const length = Math.hypot(...normal);
  return length > EPSILON ? normal.map((value) => value / length) : null;
}

function directionFor(normal) {
  return NORMALS.findIndex((candidate) =>
    candidate.every((value, index) => Math.abs(value - normal[index]) < EPSILON)
  );
}

// Coordinates in the canonical texture frame of each outward-facing plane.
function faceProjection(point, direction) {
  const [x, y, z] = point;
  return [
    [z, 1 - y],
    [1 - z, 1 - y],
    [x, 1 - z],
    [x, z],
    [1 - x, 1 - y],
    [x, 1 - y],
  ][direction];
}

function faceUvs(face, element, direction, placement) {
  const [u0, v0, u1, v1] =
    face.uv || defaultUv(element.from, element.to, direction);
  const corners = [
    [u0, v0],
    [u0, v1],
    [u1, v1],
    [u1, v0],
  ];
  const turns = (face.rotation || 0) / 90;
  let result = corners.map((_value, index) => corners[(index + turns) % 4]);
  if (placement.uvlock && (placement.x || placement.y || placement.z)) {
    // Rotate UV coordinates around the block's UV center, independent of the
    // element bounds. This preserves the scale/offset of cropped slab textures.
    const cube = faceVertices([0, 0, 0], [16, 16, 16], direction);
    const newDirection = directionFor(
      rotatePlacement(NORMALS[direction], placement, false)
    );
    const points = cube.map((point) =>
      faceProjection(rotatePlacement(point, placement), newDirection)
    );
    const p0 = points[0];
    const alongU = points[3].map((value, index) => value - p0[index]);
    const alongV = points[1].map((value, index) => value - p0[index]);
    result = result.map(([u, v]) => [
      16 * p0[0] + alongU[0] * u + alongV[0] * v,
      16 * p0[1] + alongU[1] * u + alongV[1] * v,
    ]);
  }
  return result;
}

function boundaryRectangle(vertices, normal) {
  const direction = directionFor(normal);
  if (direction < 0) {
    return null;
  }
  const axis = Math.floor(direction / 2);
  const plane = direction % 2;
  if (!vertices.every((point) => Math.abs(point[axis] - plane) < EPSILON)) {
    return null;
  }
  const [u, v] = PROJECTION_AXES[axis];
  const rectangle = [
    Math.min(...vertices.map((point) => point[u])),
    Math.min(...vertices.map((point) => point[v])),
    Math.max(...vertices.map((point) => point[u])),
    Math.max(...vertices.map((point) => point[v])),
  ];
  if (
    !vertices.every(
      (point) =>
        (Math.abs(point[u] - rectangle[0]) < EPSILON ||
          Math.abs(point[u] - rectangle[2]) < EPSILON) &&
        (Math.abs(point[v] - rectangle[1]) < EPSILON ||
          Math.abs(point[v] - rectangle[3]) < EPSILON)
    )
  ) {
    return null;
  }
  return {
    direction,
    rectangle: rectangle.map((value) => Math.min(1, Math.max(0, value))),
  };
}

export function createVanillaModelResolver(data = BLOCK_MODELS, atlas = ATLAS) {
  const cache = new Map();
  const selections = new Map();
  let cachedFaces = 0;
  function selectionFor(entry) {
    const name = typeof entry === "string" ? entry : entry.name;
    if (!name?.startsWith("minecraft:")) {
      return null;
    }
    const id = name.slice(10);
    const state = Object.hasOwn(data.states, id) ? data.states[id] : null;
    if (!state) {
      return null;
    }
    const properties = entry.properties || {};
    const key = JSON.stringify([id, properties]);
    if (selections.has(key)) {
      return selections.get(key);
    }
    const choices = placementChoicesFor(state, properties);
    const selection = {
      id,
      properties,
      choices,
      period: choicePeriod(choices),
    };
    if (selections.size >= MAX_CACHED_MODELS) {
      selections.delete(selections.keys().next().value);
    }
    selections.set(key, selection);
    return selection;
  }
  function resolve(entry, seed = 0) {
    const selection = selectionFor(entry);
    if (!selection) {
      return null;
    }
    const { id, properties, choices } = selection;
    const placements = choices.map((choice, index) =>
      chooseWeighted(choice, seed + index)
    );
    const tint = tintFor(id, properties);
    const intentionalEmpty =
      [
        "air",
        "cave_air",
        "void_air",
        "barrier",
        "light",
        "structure_void",
      ].includes(id) ||
      (id === "pitcher_crop" &&
        properties.half === "upper" &&
        Number(properties.age) < 3);
    const key = JSON.stringify([placements, tint, intentionalEmpty]);
    if (cache.has(key)) {
      return cache.get(key);
    }
    const faces = [];
    const occlusion = Array.from({ length: 6 }, () => []);
    let supported = placements.length > 0;
    let reason = supported ? "" : "state";
    for (const placement of placements) {
      const model = data.models[placement.model];
      const elements = data.geometries[model.geometry];
      if (!elements.length) {
        if (!intentionalEmpty) {
          supported = false;
          reason = "special_renderer";
        }
        continue;
      }
      for (const element of elements) {
        for (const [faceName, face] of Object.entries(element.faces)) {
          const direction = DIRECTIONS.indexOf(faceName);
          const texture =
            face.texture.startsWith("#") ||
            Object.hasOwn(model.textures, face.texture)
              ? model.textures[face.texture.replace(/^#/, "")]
              : {
                  sprite: face.texture.replace(/^minecraft:/, ""),
                  translucent: false,
                };
          const tileName = texture?.sprite?.replace(/^block\//, "");
          const tile =
            tileName && Object.hasOwn(atlas.tiles, tileName)
              ? atlas.tiles[tileName]
              : null;
          if (!tile) {
            supported = false;
            reason = "texture";
            continue;
          }
          const vertices = faceVertices(
            element.from,
            element.to,
            direction
          ).map((point) =>
            rotatePlacement(rotateElement(point, element.rotation), placement)
          );
          const normal = normalFor(vertices);
          if (!normal) {
            continue;
          }
          const uvs = faceUvs(face, element, direction, placement).flatMap(
            ([u, v]) => [
              (tile.x + (u / 16) * tile.width) / atlas.width,
              1 - (tile.y + (v / 16) * tile.height) / atlas.height,
            ]
          );
          const layer =
            texture.translucent || tile.translucent ? "translucent" : "opaque";
          const override = DIRECTIONS.indexOf(element.shade_direction_override);
          const shadeNormal = override >= 0 ? NORMALS[override] : normal;
          faces.push({
            vertices: vertices.flat(),
            uvs,
            normal,
            cullface: face.cullface
              ? directionFor(
                  rotatePlacement(
                    NORMALS[DIRECTIONS.indexOf(face.cullface)],
                    placement,
                    false
                  )
                )
              : -1,
            tint:
              face.tintindex !== undefined && face.tintindex >= 0
                ? tint
                : WHITE,
            layer,
            shade: element.shade !== false && override !== 3,
            shadeNormal,
            cutout: tile.cutout,
            texture: tileName,
          });
          if (layer === "opaque" && !tile.cutout) {
            const boundary = boundaryRectangle(vertices, normal);
            if (boundary) {
              occlusion[boundary.direction].push(boundary.rectangle);
            }
          }
        }
      }
    }
    const result = { supported, reason, faces, occlusion };
    // Bound cache memory independently from user palettes and repeated layer rebuilds.
    while (
      cache.size &&
      (cache.size >= MAX_CACHED_MODELS ||
        cachedFaces + faces.length > MAX_CACHED_FACES)
    ) {
      const first = cache.keys().next().value;
      cachedFaces -= cache.get(first).faces.length;
      cache.delete(first);
    }
    if (faces.length <= MAX_CACHED_FACES) {
      cache.set(key, result);
      cachedFaces += faces.length;
    }
    return result;
  }
  resolve.seedPeriod = (entry) => selectionFor(entry)?.period || 1;
  return resolve;
}

export const resolveVanillaModel = createVanillaModelResolver();

/** Coordinate hashes can be reduced modulo this exact weighted-choice period.
 * Matching state conditions are cached and shared with the resolver. */
export const vanillaModelSeedPeriod = (entry) =>
  resolveVanillaModel.seedPeriod(entry);
