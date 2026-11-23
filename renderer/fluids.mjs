import { ATLAS } from "./generated/texture-atlas.mjs";

const WATER_TINT = [0x3f, 0x76, 0xe4].map((channel) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
});
const OFFSETS = [
  [-1, 0, 0],
  [1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
];

/** Static fluid state decoded from a palette entry; waterlogging preserves the
 * block's own model. Falling levels carry a full flowing column's amount. */
export function fluidState(entry) {
  const name = typeof entry === "string" ? entry : entry?.name;
  const properties = entry?.properties || {};
  if (name === "minecraft:bubble_column") {
    return { type: "water", level: 0, height: 8 / 9, waterlogged: false };
  }
  if (name === "minecraft:water" || name === "minecraft:lava") {
    const level = Math.max(0, Math.min(15, Number(properties.level) || 0));
    return {
      type: name.slice(10),
      level,
      height: (level === 0 || level >= 8 ? 8 : 8 - level) / 9,
      waterlogged: false,
    };
  }
  if (name?.startsWith("minecraft:") && properties.waterlogged === "true") {
    return { type: "water", level: 0, height: 8 / 9, waterlogged: true };
  }
  return null;
}

function uv(name, u, v) {
  const tile = ATLAS.tiles[name];
  return [
    (tile.x + u * tile.width) / ATLAS.width,
    1 - (tile.y + v * tile.height) / ATLAS.height,
  ];
}

function quad(vertices, texture, coordinates, fluid, cullface, normal) {
  if (!normal) {
    const a = vertices.slice(3, 6).map((value, axis) => value - vertices[axis]);
    const b = vertices.slice(6, 9).map((value, axis) => value - vertices[axis]);
    normal = [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const length = Math.hypot(...normal) || 1;
    normal = normal.map((value) => value / length);
  }
  return {
    vertices,
    uvs: coordinates.flatMap(([u, v]) => uv(texture, u, v)),
    normal,
    cullface,
    tint: fluid.type === "water" ? WATER_TINT : [1, 1, 1],
    layer: fluid.type === "water" ? "translucent" : "opaque",
    shade: fluid.type === "water",
    fluid: true,
  };
}

/** sample(dx,dy,dz) returns a compiled neighboring block with {fluid,solid}.
 * The same four samples produce both sides of a shared corner, including
 * across regions. A small local cache bounds work for each visible fluid. */
export function createFluidFaces(fluid, sample) {
  const cells = new Map();
  const at = (x, y, z) => {
    const key = (y + 1) * 9 + (z + 1) * 3 + x + 1;
    if (!cells.has(key)) {
      cells.set(key, sample(x, y, z));
    }
    return cells.get(key);
  };
  const same = (cell) => cell?.fluid?.type === fluid.type;
  if (OFFSETS.every((offset) => same(at(...offset)))) {
    return [];
  }
  const heights = new Float64Array(9);
  heights.fill(NaN);
  const height = (x, z) => {
    const index = (z + 1) * 3 + x + 1;
    if (Number.isNaN(heights[index])) {
      const cell = at(x, 0, z);
      heights[index] = same(cell)
        ? same(at(x, 1, z))
          ? 1
          : cell.fluid.height
        : cell?.solid
          ? -1
          : 0;
    }
    return heights[index];
  };
  const corner = (x, z) => {
    let sum = 0;
    let weights = 0;
    for (const dx of [x - 1, x]) {
      for (const dz of [z - 1, z]) {
        const value = height(dx, dz);
        if (value === 1) {
          return 1;
        }
        if (value >= 0) {
          const weight = value >= 0.8 ? 10 : 1;
          sum += value * weight;
          weights += weight;
        }
      }
    }
    return weights ? sum / weights : fluid.height;
  };
  const h00 = corner(0, 0);
  const h01 = corner(0, 1);
  const h11 = corner(1, 1);
  const h10 = corner(1, 0);
  const faces = [];
  if (!same(at(0, 1, 0))) {
    const dx = h10 + h11 - h00 - h01;
    const dz = h01 + h11 - h00 - h10;
    const flowing = fluid.level >= 8 || Math.hypot(dx, dz) > 1e-7;
    const angle = Math.atan2(dz, dx);
    const coordinates = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ].map(([x, z]) =>
      flowing
        ? [
            0.5 +
              ((x - 0.5) * Math.cos(angle) - (z - 0.5) * Math.sin(angle)) * 0.5,
            0.5 +
              ((x - 0.5) * Math.sin(angle) + (z - 0.5) * Math.cos(angle)) * 0.5,
          ]
        : [x, z]
    );
    faces.push(
      quad(
        [0, h00, 0, 0, h01, 1, 1, h11, 1, 1, h10, 0],
        `${fluid.type}_${flowing ? "flow" : "still"}`,
        coordinates,
        fluid,
        3
      )
    );
  }
  if (!same(at(0, -1, 0))) {
    faces.push(
      quad(
        [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1],
        `${fluid.type}_still`,
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
        fluid,
        2,
        [0, -1, 0]
      )
    );
  }
  const sides = [
    [0, [0, 0, 1, 0, h01, 1, 0, h00, 0, 0, 0, 0]],
    [1, [1, 0, 0, 1, h10, 0, 1, h11, 1, 1, 0, 1]],
    [4, [0, 0, 0, 0, h00, 0, 1, h10, 0, 1, 0, 0]],
    [5, [1, 0, 1, 1, h11, 1, 0, h01, 1, 0, 0, 1]],
  ];
  for (const [direction, vertices] of sides) {
    if (same(at(...OFFSETS[direction]))) {
      continue;
    }
    const coordinates = [
      [0, 0.5],
      [0, (1 - vertices[4]) * 0.5],
      [0.5, (1 - vertices[7]) * 0.5],
      [0.5, 0.5],
    ];
    faces.push(
      quad(
        vertices,
        `${fluid.type}_flow`,
        coordinates,
        fluid,
        direction,
        OFFSETS[direction]
      )
    );
  }
  return faces;
}
