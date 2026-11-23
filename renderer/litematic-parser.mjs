// Original browser-only Litematic reader. All budgets apply before allocation.
export const DEFAULT_LIMITS = Object.freeze({
  compressedBytes: 64 * 1024 * 1024,
  decompressedBytes: 128 * 1024 * 1024,
  volume: 4_000_000,
  blocks: 1_000_000,
  regions: 256,
  dimension: 2048,
  palette: 65_536,
  depth: 32,
  entries: 2_000_000,
  listEntries: 1_000_000,
  stringBytes: 65_535,
});

export class LitematicError extends Error {
  constructor(category, message) {
    super(message);
    this.name = "LitematicError";
    this.category = category;
  }
}

const invalid = (message) => {
  throw new LitematicError("invalid", message);
};
const complex = (message) => {
  throw new LitematicError("too_complex", message);
};
const utf8 = new TextDecoder("utf-8", { fatal: true });

function budgets(overrides = {}) {
  const result = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(overrides)) {
    if (
      !(key in result) ||
      !Number.isSafeInteger(overrides[key]) ||
      overrides[key] < 1
    ) {
      throw new TypeError(`Invalid parser limit: ${key}`);
    }
    // Callers can lower a limit; hard safety limits cannot be raised.
    result[key] = Math.min(result[key], overrides[key]);
  }
  return result;
}

function bytesOf(input) {
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (input instanceof Uint8Array) {
    return input;
  }
  invalid("Expected binary schematic data.");
}

// Java NBT uses modified UTF-8. Accept normal UTF-8 as well, since many
// third-party writers use it, while rejecting malformed byte sequences.
/* eslint-disable no-bitwise -- Modified UTF-8 decoding operates on byte bits. */
function decodeString(bytes) {
  try {
    return utf8.decode(bytes);
  } catch {
    const parts = [];
    for (let i = 0; i < bytes.length; ) {
      const first = bytes[i++];
      let code;
      if (first < 0x80) {
        code = first;
      } else if ((first & 0xe0) === 0xc0) {
        const second = bytes[i++];
        if ((second & 0xc0) !== 0x80) {
          invalid("Invalid NBT string encoding.");
        }
        code = ((first & 0x1f) << 6) | (second & 0x3f);
        if (code < 0x80 && code !== 0) {
          invalid("Invalid NBT string encoding.");
        }
      } else if ((first & 0xf0) === 0xe0) {
        const second = bytes[i++];
        const third = bytes[i++];
        if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80) {
          invalid("Invalid NBT string encoding.");
        }
        code = ((first & 0xf) << 12) | ((second & 0x3f) << 6) | (third & 0x3f);
        if (code < 0x800) {
          invalid("Invalid NBT string encoding.");
        }
      } else {
        invalid("Invalid NBT string encoding.");
      }
      parts.push(String.fromCharCode(code));
    }
    return parts.join("");
  }
}
/* eslint-enable no-bitwise */

class LongArray {
  constructor(bytes, length) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.length = length;
  }
}

// Retain only data used by the preview. Entity inventories, embedded previews,
// ticks and author metadata are still validated and budgeted, but do not become
// large JS object trees or copied typed arrays.
function selectedField(projection, name, type) {
  let fields;
  if (projection === "root") {
    fields = {
      Version: [3, null],
      MinecraftDataVersion: [3, null],
      Metadata: [10, "metadata"],
      Regions: [10, "regions"],
    };
  } else if (projection === "metadata") {
    fields = { Name: [8, null] };
  } else if (projection === "region") {
    fields = {
      Position: [10, "vector"],
      Size: [10, "vector"],
      BlockStatePalette: [9, "palette"],
      BlockStates: [12, null],
    };
  } else if (projection === "vector") {
    fields = { x: [3, null], y: [3, null], z: [3, null] };
  } else if (projection === "paletteEntry") {
    fields = { Name: [8, null], Properties: [10, "properties"] };
  } else if (projection === "regions" || projection === "properties") {
    const expected = projection === "regions" ? 10 : 8;
    if (type !== expected) {
      invalid(`Invalid ${projection} field type.`);
    }
    return {
      retain: true,
      projection: projection === "regions" ? "region" : null,
    };
  } else {
    return { retain: true, projection: null };
  }
  const expected = Object.hasOwn(fields, name) && fields[name];
  if (!expected) {
    return { retain: false, projection: null };
  }
  if (type !== expected[0]) {
    invalid(`Invalid ${name} tag type.`);
  }
  return { retain: true, projection: expected[1] };
}

class Reader {
  constructor(bytes, limits) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
    this.entries = 0;
    this.limits = limits;
  }

  take(length) {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > this.bytes.length - this.offset
    ) {
      invalid("Truncated or invalid NBT data.");
    }
    const start = this.offset;
    this.offset += length;
    return start;
  }

  u8() {
    return this.view.getUint8(this.take(1));
  }

  int() {
    return this.view.getInt32(this.take(4), false);
  }

  string() {
    const length = this.view.getUint16(this.take(2), false);
    if (length > this.limits.stringBytes) {
      complex("NBT string exceeds the preview limit.");
    }
    const start = this.take(length);
    return decodeString(this.bytes.subarray(start, start + length));
  }

  length() {
    const length = this.int();
    if (length < 0) {
      invalid("Negative NBT array or list length.");
    }
    return length;
  }

  tag(type, depth, retain = true, projection = null) {
    if (depth > this.limits.depth) {
      complex("NBT nesting exceeds the preview limit.");
    }
    if (++this.entries > this.limits.entries) {
      complex("NBT entries exceed the preview limit.");
    }
    switch (type) {
      case 1:
        return this.view.getInt8(this.take(1));
      case 2:
        return this.view.getInt16(this.take(2), false);
      case 3:
        return this.int();
      case 4:
        return this.view.getBigInt64(this.take(8), false);
      case 5:
        return this.view.getFloat32(this.take(4), false);
      case 6:
        return this.view.getFloat64(this.take(8), false);
      case 7: {
        const length = this.length();
        const start = this.take(length);
        return retain ? this.bytes.subarray(start, start + length) : null;
      }
      case 8:
        return this.string();
      case 9: {
        const childType = this.u8();
        const length = this.length();
        if (childType > 12 || (childType === 0 && length !== 0)) {
          invalid("Invalid NBT list type.");
        }
        if (
          length > this.limits.listEntries ||
          length > this.limits.entries - this.entries
        ) {
          complex("NBT list exceeds the preview limit.");
        }
        if (projection === "palette") {
          if (childType !== 10) {
            invalid("Block palette must be a list of compounds.");
          }
          if (length > this.limits.palette) {
            complex("Block palette exceeds the preview limit.");
          }
        }
        // Every non-end tag needs at least one byte, including empty compounds.
        if (length > this.bytes.length - this.offset) {
          invalid("Truncated NBT list.");
        }
        const list = retain ? new Array(length) : null;
        for (let i = 0; i < length; i++) {
          const value = this.tag(
            childType,
            depth + 1,
            retain,
            projection === "palette" ? "paletteEntry" : null
          );
          if (retain) {
            list[i] = value;
          }
        }
        return list;
      }
      case 10: {
        const record = retain ? Object.create(null) : null;
        const fields = new Set();
        while (true) {
          const childType = this.u8();
          if (childType === 0) {
            return record;
          }
          if (childType > 12) {
            invalid("Unknown NBT tag type.");
          }
          const name = this.string();
          if (fields.has(name)) {
            invalid("Duplicate NBT compound field.");
          }
          fields.add(name);
          if (projection === "regions" && fields.size > this.limits.regions) {
            complex("Region count exceeds the preview limit.");
          }
          const selection = retain
            ? selectedField(projection, name, childType)
            : { retain: false, projection: null };
          const value = this.tag(
            childType,
            depth + 1,
            selection.retain,
            selection.projection
          );
          if (selection.retain) {
            record[name] = value;
          }
        }
      }
      case 11: {
        const length = this.length();
        const start = this.take(length * 4);
        if (!retain) {
          return null;
        }
        const array = new Int32Array(length);
        for (let i = 0; i < length; i++) {
          array[i] = this.view.getInt32(start + i * 4, false);
        }
        return array;
      }
      case 12: {
        const length = this.length();
        const start = this.take(length * 8);
        return retain
          ? new LongArray(
              this.bytes.subarray(start, start + length * 8),
              length
            )
          : null;
      }
      default:
        invalid("Unknown NBT tag type.");
    }
  }

  root() {
    if (this.u8() !== 10) {
      invalid("Litematic root must be an NBT compound.");
    }
    this.string();
    const root = this.tag(10, 0, true, "root");
    if (this.offset !== this.bytes.length) {
      invalid("Unexpected trailing NBT data.");
    }
    return root;
  }
}

function compound(value, name) {
  if (!value || Object.getPrototypeOf(value) !== null) {
    invalid(`Missing or invalid ${name}.`);
  }
  return value;
}

function integer(value, name) {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
    invalid(`Missing or invalid ${name}.`);
  }
  return value;
}

function vector(value, name) {
  compound(value, name);
  return ["x", "y", "z"].map((axis) => integer(value[axis], `${name}.${axis}`));
}

export function isAir(name) {
  return (
    name === "minecraft:air" ||
    name === "minecraft:cave_air" ||
    name === "minecraft:void_air"
  );
}

function readPalette(value, limits) {
  if (!Array.isArray(value) || value.length === 0) {
    invalid("Missing or empty block palette.");
  }
  if (value.length > limits.palette) {
    complex("Block palette exceeds the preview limit.");
  }
  return value.map((entry) => {
    compound(entry, "block palette entry");
    if (typeof entry.Name === "string" && entry.Name.length > 512) {
      complex("Block identifier exceeds the preview limit.");
    }
    if (
      typeof entry.Name !== "string" ||
      !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(entry.Name)
    ) {
      invalid("Invalid block identifier.");
    }
    const properties = Object.create(null);
    if (entry.Properties !== undefined) {
      compound(entry.Properties, "block properties");
      const entries = Object.entries(entry.Properties);
      if (entries.length > 64) {
        complex("Block property count exceeds the preview limit.");
      }
      for (const [key, property] of entries) {
        if (typeof property !== "string") {
          invalid("Invalid block property value.");
        }
        if (key.length > 128 || property.length > 256) {
          complex("Block property length exceeds the preview limit.");
        }
        properties[key] = property;
      }
    }
    return { name: entry.Name, properties };
  });
}

/* eslint-disable no-bitwise -- Litematic states are packed across 64-bit words. */
function readBlocks(longArray, count, paletteLength) {
  if (!(longArray instanceof LongArray)) {
    invalid("Missing block state long array.");
  }
  const bits = Math.max(2, Math.ceil(Math.log2(paletteLength)));
  const expected = Math.ceil((count * bits) / 64);
  if (longArray.length !== expected) {
    invalid("Block state array does not match the region volume.");
  }
  const blocks = new Uint32Array(count);
  const mask = (1 << bits) - 1;
  // Litematic longs form one continuous little-bit-order stream. NBT stores
  // each individual 64-bit word big-endian; entries may straddle words.
  for (let i = 0; i < count; i++) {
    const bit = i * bits;
    const word = Math.floor(bit / 32);
    const shift = bit % 32;
    const offset = Math.floor(word / 2) * 8 + (word % 2 === 0 ? 4 : 0);
    let value = longArray.view.getUint32(offset, false) >>> shift;
    if (shift + bits > 32) {
      const next = word + 1;
      const nextOffset = Math.floor(next / 2) * 8 + (next % 2 === 0 ? 4 : 0);
      value |= longArray.view.getUint32(nextOffset, false) << (32 - shift);
    }
    value &= mask;
    if (value >= paletteLength) {
      invalid("Block state references an absent palette entry.");
    }
    blocks[i] = value;
  }
  return blocks;
}
/* eslint-enable no-bitwise */

function intersects(a, b) {
  return a.position.every(
    (value, axis) =>
      value < b.position[axis] + b.size[axis] &&
      b.position[axis] < value + a.size[axis]
  );
}

function resolveOverlaps(regions, bounds, limits) {
  const overlaps = regions.some((region, index) =>
    regions.slice(index + 1).some((other) => intersects(region, other))
  );
  if (!overlaps) {
    return;
  }
  const width = bounds.max[0] - bounds.min[0];
  const depth = bounds.max[2] - bounds.min[2];
  // Only numeric keys/values, avoiding a JS object allocation per block.
  // Region volume is bounded, so an owner fits exactly in a JS number.
  const owners = new Map();
  const stride = limits.volume + 1;
  const airIndices = regions.map((region) => {
    let airIndex = region.palette.findIndex((entry) => isAir(entry.name));
    if (airIndex < 0) {
      airIndex = region.palette.length;
      region.palette.push({
        name: "minecraft:air",
        properties: Object.create(null),
      });
    }
    return airIndex;
  });
  regions.forEach((region, regionIndex) => {
    const [sx, sy, sz] = region.size;
    let index = 0;
    for (let y = 0; y < sy; y++) {
      const globalY = y + region.position[1] - bounds.min[1];
      for (let z = 0; z < sz; z++) {
        const globalZ = z + region.position[2] - bounds.min[2];
        const row =
          width * (globalZ + depth * globalY) +
          region.position[0] -
          bounds.min[0];
        for (let x = 0; x < sx; x++, index++) {
          const key = row + x;
          const previous = owners.get(key);
          if (previous !== undefined) {
            const owner = Math.floor(previous / stride);
            regions[owner].blocks[previous % stride] = airIndices[owner];
          }
          if (isAir(region.palette[region.blocks[index]].name)) {
            owners.delete(key);
          } else {
            owners.set(key, regionIndex * stride + index);
            if (owners.size > limits.blocks) {
              complex("Visible blocks exceed the preview limit.");
            }
          }
        }
      }
    }
  });
}

function sceneFromNbt(root, limits) {
  const version = integer(root.Version, "Litematic version");
  if (version < 5 || version > 7) {
    throw new LitematicError(
      "unsupported",
      `Unsupported Litematic format version: ${version}.`
    );
  }
  const sourceRegions = Object.entries(compound(root.Regions, "regions"));
  if (sourceRegions.length === 0) {
    invalid("The schematic has no regions.");
  }
  if (sourceRegions.length > limits.regions) {
    complex("Region count exceeds the preview limit.");
  }
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  let volume = 0;
  const regions = sourceRegions.map(([name, value]) => {
    compound(value, "region");
    const signedSize = vector(value.Size, "region size");
    const size = signedSize.map(Math.abs);
    if (size.some((axis) => axis === 0)) {
      invalid("A region has a zero dimension.");
    }
    if (size.some((axis) => axis > limits.dimension)) {
      complex("Region dimensions exceed the preview limit.");
    }
    const count = size[0] * size[1] * size[2];
    volume += count;
    if (volume > limits.volume) {
      complex("Schematic volume exceeds the preview limit.");
    }
    const position = vector(value.Position, "region position").map(
      (axis, i) => axis + Math.min(0, signedSize[i] + 1)
    );
    for (let axis = 0; axis < 3; axis++) {
      bounds.min[axis] = Math.min(bounds.min[axis], position[axis]);
      bounds.max[axis] = Math.max(
        bounds.max[axis],
        position[axis] + size[axis]
      );
      if (bounds.max[axis] - bounds.min[axis] > limits.dimension) {
        complex("Schematic dimensions exceed the preview limit.");
      }
    }
    const palette = readPalette(value.BlockStatePalette, limits);
    const blocks = readBlocks(value.BlockStates, count, palette.length);
    return { name, position, size, palette, blocks };
  });
  resolveOverlaps(regions, bounds, limits);
  let blockCount = 0;
  const materialCounts = new Map();
  for (const region of regions) {
    const counts = new Uint32Array(region.palette.length);
    for (const index of region.blocks) {
      counts[index]++;
    }
    for (let index = 0; index < region.palette.length; index++) {
      const entry = region.palette[index];
      const count = counts[index];
      if (count && !isAir(entry.name)) {
        blockCount += count;
        if (blockCount > limits.blocks) {
          complex("Visible blocks exceed the preview limit.");
        }
        materialCounts.set(
          entry.name,
          (materialCounts.get(entry.name) || 0) + count
        );
      }
    }
  }
  const materials = Array.from(materialCounts, ([name, count]) => ({
    name,
    count,
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    version,
    minecraftDataVersion: Number.isInteger(root.MinecraftDataVersion)
      ? root.MinecraftDataVersion
      : null,
    name: typeof root.Metadata?.Name === "string" ? root.Metadata.Name : "",
    regions,
    bounds,
    volume,
    blockCount,
    materials,
  };
}

export function parseLitematicData(input, overrides = {}) {
  const limits = budgets(overrides);
  const bytes = bytesOf(input);
  if (bytes.byteLength > limits.decompressedBytes) {
    complex("Decompressed schematic exceeds the preview limit.");
  }
  return sceneFromNbt(new Reader(bytes, limits).root(), limits);
}

export async function parseLitematic(input, overrides = {}) {
  const limits = budgets(overrides);
  const bytes = bytesOf(input);
  if (bytes.byteLength > limits.compressedBytes) {
    complex("Compressed schematic exceeds the preview limit.");
  }
  if (
    bytes.length < 3 ||
    bytes[0] !== 0x1f ||
    bytes[1] !== 0x8b ||
    bytes[2] !== 8
  ) {
    invalid("The attachment is not a gzip Litematic file.");
  }
  if (typeof DecompressionStream !== "function") {
    throw new LitematicError(
      "unsupported",
      "This browser cannot decompress Litematic files."
    );
  }
  const inputStream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = inputStream
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      length += value.byteLength;
      if (length > limits.decompressedBytes) {
        await reader.cancel().catch(() => {});
        complex("Decompressed schematic exceeds the preview limit.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof LitematicError) {
      throw error;
    }
    invalid("The compressed schematic is damaged.");
  } finally {
    reader.releaseLock();
  }
  const expanded = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    expanded.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return parseLitematicData(expanded, limits);
}
