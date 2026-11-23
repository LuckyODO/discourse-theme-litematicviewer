import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  DEFAULT_LIMITS,
  LitematicError,
  parseLitematic,
  parseLitematicData,
} from "../../renderer/litematic-parser.mjs";

const tag = (type, value) => ({ type, value });
const int = (value) => tag(3, value);
const string = (value) => tag(8, value);
const compound = (value) => tag(10, value);
const vector = ([x, y, z]) => compound({ x: int(x), y: int(y), z: int(z) });

function numberBytes(length, method, value) {
  const bytes = Buffer.alloc(length);
  bytes[method](value);
  return bytes;
}

function nbtString(value) {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([numberBytes(2, "writeUInt16BE", bytes.length), bytes]);
}

function payload({ type, value }) {
  switch (type) {
    case 1:
      return numberBytes(1, "writeInt8", value);
    case 2:
      return numberBytes(2, "writeInt16BE", value);
    case 3:
      return numberBytes(4, "writeInt32BE", value);
    case 4:
      return numberBytes(8, "writeBigInt64BE", value);
    case 5:
      return numberBytes(4, "writeFloatBE", value);
    case 6:
      return numberBytes(8, "writeDoubleBE", value);
    case 7:
      return Buffer.concat([
        numberBytes(4, "writeInt32BE", value.length),
        Buffer.from(value),
      ]);
    case 8:
      return nbtString(value);
    case 9:
      return Buffer.concat([
        Buffer.from([value.type]),
        numberBytes(4, "writeInt32BE", value.items.length),
        ...value.items.map((item) => payload(tag(value.type, item))),
      ]);
    case 10:
      return Buffer.concat([
        ...Object.entries(value).map(([name, item]) =>
          Buffer.concat([
            Buffer.from([item.type]),
            nbtString(name),
            payload(item),
          ])
        ),
        Buffer.from([0]),
      ]);
    case 11:
      return Buffer.concat([
        numberBytes(4, "writeInt32BE", value.length),
        ...value.map((item) => numberBytes(4, "writeInt32BE", item)),
      ]);
    case 12:
      return Buffer.concat([
        numberBytes(4, "writeInt32BE", value.length),
        ...value.map((item) =>
          numberBytes(8, "writeBigUInt64BE", BigInt.asUintN(64, item))
        ),
      ]);
    default:
      throw new Error("Unknown fixture type");
  }
}

function nbt(root) {
  return Buffer.concat([
    Buffer.from([10]),
    nbtString(""),
    payload(compound(root)),
  ]);
}

/* eslint-disable no-bitwise -- Fixture packing is independent BigInt bit arithmetic. */
function pack(indices, paletteLength) {
  const bits = BigInt(Math.max(2, Math.ceil(Math.log2(paletteLength))));
  const words = Array.from(
    { length: Math.ceil((indices.length * Number(bits)) / 64) },
    () => 0n
  );
  for (let i = 0; i < indices.length; i++) {
    const start = BigInt(i) * bits;
    const word = Number(start / 64n);
    const shift = start % 64n;
    words[word] |= BigInt(indices[i]) << shift;
    if (shift + bits > 64n) {
      words[word + 1] |= BigInt(indices[i]) >> (64n - shift);
    }
  }
  return words.map((word) => BigInt.asUintN(64, word));
}
/* eslint-enable no-bitwise */

function region({
  size = [2, 1, 1],
  position = [0, 0, 0],
  names = ["minecraft:air", "minecraft:stone"],
  indices = [0, 1],
  properties = {},
} = {}) {
  return compound({
    Position: vector(position),
    Size: vector(size),
    BlockStatePalette: tag(9, {
      type: 10,
      items: names.map((name, index) => ({
        Name: string(name),
        ...(properties[index]
          ? {
              Properties: compound(
                Object.fromEntries(
                  Object.entries(properties[index]).map(([key, value]) => [
                    key,
                    string(value),
                  ])
                )
              ),
            }
          : {}),
      })),
    }),
    BlockStates: tag(12, pack(indices, names.length)),
  });
}

function schematic(regions = { main: region() }, extra = {}) {
  return {
    Version: int(6),
    SubVersion: int(1),
    MinecraftDataVersion: int(4189),
    Metadata: compound({ Name: string("测试 🏠") }),
    Regions: compound(regions),
    ...extra,
  };
}

function category(expected) {
  return (error) =>
    error instanceof LitematicError && error.category === expected;
}

test("gzip Litematic loads typed blocks, metadata and material counts without network", async () => {
  const scene = await parseLitematic(gzipSync(nbt(schematic())));
  assert.equal(scene.name, "测试 🏠");
  assert.equal(scene.version, 6);
  assert.equal(scene.minecraftDataVersion, 4189);
  assert.deepEqual(scene.bounds, { min: [0, 0, 0], max: [2, 1, 1] });
  assert.equal(scene.blockCount, 1);
  assert.equal(scene.volume, 2);
  assert.ok(scene.regions[0].blocks instanceof Uint32Array);
  assert.deepEqual([...scene.regions[0].blocks], [0, 1]);
  assert.deepEqual(scene.materials, [{ name: "minecraft:stone", count: 1 }]);
});

test("continuous packed states decode across 32-bit and 64-bit boundaries", () => {
  for (const paletteLength of [2, 5, 17, 129, 513]) {
    const names = Array.from(
      { length: paletteLength },
      (_, i) => `example:block_${i}`
    );
    const indices = Array.from(
      { length: 131 },
      (_, i) => (i * 13 + 3) % paletteLength
    );
    const scene = parseLitematicData(
      nbt(schematic({ packed: region({ size: [131, 1, 1], names, indices }) }))
    );
    assert.deepEqual(
      [...scene.regions[0].blocks],
      indices,
      `palette size ${paletteLength}`
    );
  }
});

test("minimum two bits also applies to a one-entry palette", () => {
  const scene = parseLitematicData(
    nbt(
      schematic({
        main: region({
          size: [35, 1, 1],
          names: ["minecraft:stone"],
          indices: Array(35).fill(0),
        }),
      })
    )
  );
  assert.equal(scene.blockCount, 35);
  assert.deepEqual([...scene.regions[0].blocks], Array(35).fill(0));
});

test("signed dimensions normalize origin without mirroring block storage", () => {
  const names = ["minecraft:stone", "minecraft:dirt", "minecraft:glass"];
  const scene = parseLitematicData(
    nbt(
      schematic({
        negative: region({
          size: [-3, -2, -2],
          position: [8, 5, -2],
          names,
          indices: [0, 1, 2, 2, 1, 0, 1, 0, 2, 2, 0, 1],
        }),
      })
    )
  );
  assert.deepEqual(scene.regions[0].position, [6, 4, -3]);
  assert.deepEqual(scene.regions[0].size, [3, 2, 2]);
  assert.deepEqual(scene.bounds, { min: [6, 4, -3], max: [9, 6, -1] });
  assert.deepEqual(
    [...scene.regions[0].blocks],
    [0, 1, 2, 2, 1, 0, 1, 0, 2, 2, 0, 1]
  );
});

test("all supported format versions load and unknown versions are explicit", () => {
  for (const version of [5, 6, 7]) {
    assert.equal(
      parseLitematicData(nbt(schematic(undefined, { Version: int(version) })))
        .version,
      version
    );
  }
  for (const version of [4, 8]) {
    assert.throws(
      () =>
        parseLitematicData(
          nbt(schematic(undefined, { Version: int(version) }))
        ),
      category("unsupported")
    );
  }
});

test("air detection does not depend on palette position; properties survive", () => {
  const scene = parseLitematicData(
    nbt(
      schematic({
        main: region({
          size: [5, 1, 1],
          names: [
            "minecraft:oak_stairs",
            "minecraft:cave_air",
            "minecraft:void_air",
            "minecraft:air",
          ],
          indices: [0, 1, 2, 3, 0],
          properties: {
            0: { facing: "east", half: "top", shape: "inner_left" },
          },
        }),
      })
    )
  );
  assert.equal(scene.blockCount, 2);
  assert.deepEqual(
    { ...scene.regions[0].palette[0].properties },
    { facing: "east", half: "top", shape: "inner_left" }
  );
  assert.deepEqual(scene.materials, [
    { name: "minecraft:oak_stairs", count: 2 },
  ]);
});

test("overlap uses last region including air, without duplicate solids or counts", () => {
  const scene = parseLitematicData(
    nbt(
      schematic({
        first: region({
          size: [4, 1, 1],
          names: ["minecraft:stone"],
          indices: [0, 0, 0, 0],
        }),
        second: region({
          position: [1, 0, 0],
          size: [2, 1, 1],
          names: ["minecraft:air", "minecraft:glass"],
          indices: [0, 1],
        }),
        third: region({
          position: [3, 0, 0],
          size: [1, 1, 1],
          names: ["minecraft:gold_block"],
          indices: [0],
        }),
      })
    )
  );
  assert.equal(scene.blockCount, 3);
  assert.equal(scene.volume, 7);
  assert.deepEqual([...scene.regions[0].blocks], [0, 1, 1, 1]);
  assert.deepEqual(scene.materials, [
    { name: "minecraft:glass", count: 1 },
    { name: "minecraft:gold_block", count: 1 },
    { name: "minecraft:stone", count: 1 },
  ]);
});

test("block count limit is computed after overlap removal", () => {
  const solid = region({ names: ["minecraft:stone"], indices: [0, 0] });
  const scene = parseLitematicData(nbt(schematic({ a: solid, b: solid })), {
    blocks: 2,
  });
  assert.equal(scene.blockCount, 2);
});

test("multiple separated regions aggregate bounds and materials", () => {
  const scene = parseLitematicData(
    nbt(
      schematic({
        left: region({ position: [-2, 0, 0], indices: [1, 1] }),
        right: region({ position: [3, 2, -1], indices: [1, 0] }),
      })
    )
  );
  assert.deepEqual(scene.bounds, { min: [-2, 0, -1], max: [5, 3, 1] });
  assert.equal(scene.blockCount, 3);
  assert.deepEqual(scene.materials, [{ name: "minecraft:stone", count: 3 }]);
});

test("all NBT primitive and array payloads can be skipped by the scene consumer", () => {
  const extra = {
    byte: tag(1, -128),
    short: tag(2, -32768),
    long: tag(4, -100000000000n),
    float: tag(5, 0.25),
    double: tag(6, -Math.PI),
    bytes: tag(7, [0, 255]),
    ints: tag(11, [-2147483648, 2147483647]),
    longs: tag(12, [-1n, 1n]),
    list: tag(9, { type: 3, items: [1, -2, 3] }),
    empty: tag(9, { type: 0, items: [] }),
  };
  assert.equal(
    parseLitematicData(nbt(schematic(undefined, extra))).blockCount,
    1
  );
});

test("NBT truncation, trailing bytes, invalid roots and unknown tags are rejected", () => {
  const valid = nbt(schematic());
  for (const value of [
    valid.subarray(0, valid.length - 1),
    Buffer.concat([valid, Buffer.from([0])]),
    Buffer.from([9, 0, 0]),
    Buffer.from([10, 0, 0, 42]),
  ]) {
    assert.throws(() => parseLitematicData(value), category("invalid"));
  }
});

test("NBT allocation bombs and invalid list declarations fail before allocation", () => {
  const prefix = Buffer.from([10, 0, 0]);
  for (const type of [7, 11, 12]) {
    for (const length of [-1, 2147483647]) {
      const bytes = Buffer.concat([
        prefix,
        Buffer.from([type]),
        nbtString("array"),
        numberBytes(4, "writeInt32BE", length),
      ]);
      assert.throws(() => parseLitematicData(bytes), category("invalid"));
    }
  }
  for (const child of [0, 13]) {
    const bytes = Buffer.concat([
      prefix,
      Buffer.from([9]),
      nbtString("list"),
      Buffer.from([child]),
      numberBytes(4, "writeInt32BE", 1),
      Buffer.from([0]),
    ]);
    assert.throws(() => parseLitematicData(bytes), category("invalid"));
  }
  const hugeList = Buffer.concat([
    prefix,
    Buffer.from([9]),
    nbtString("list"),
    Buffer.from([10]),
    numberBytes(4, "writeInt32BE", 2147483647),
  ]);
  assert.throws(() => parseLitematicData(hugeList), category("too_complex"));
});

test("NBT duplicate fields and excessive nesting/entries/strings are rejected", () => {
  const field = Buffer.concat([
    Buffer.from([3]),
    nbtString("Version"),
    numberBytes(4, "writeInt32BE", 6),
  ]);
  assert.throws(
    () =>
      parseLitematicData(
        Buffer.concat([Buffer.from([10, 0, 0]), field, field, Buffer.from([0])])
      ),
    category("invalid")
  );
  let nested = int(1);
  for (let i = 0; i < 35; i++) {
    nested = compound({ nested });
  }
  assert.throws(
    () => parseLitematicData(nbt(schematic(undefined, { nested }))),
    category("too_complex")
  );
  assert.throws(
    () => parseLitematicData(nbt(schematic()), { entries: 3 }),
    category("too_complex")
  );
  assert.throws(
    () => parseLitematicData(nbt(schematic()), { stringBytes: 4 }),
    category("too_complex")
  );
  assert.throws(
    () => parseLitematicData(nbt(schematic()), { listEntries: 1 }),
    category("too_complex")
  );
});

test("prototype-like NBT field names are ordinary data", () => {
  const extra = Object.create(null);
  Object.defineProperty(extra, "__proto__", {
    value: string("ordinary text"),
    enumerable: true,
  });
  extra.constructor = string("ordinary text");
  assert.equal(
    parseLitematicData(nbt(schematic(undefined, extra))).blockCount,
    1
  );
  assert.equal({}.polluted, undefined);
});

test("Java modified UTF-8 metadata is decoded and malformed strings are rejected", () => {
  const source = nbt(
    schematic(undefined, {
      Metadata: compound({ Name: string("placeholder") }),
    })
  );
  const marker = Buffer.from("placeholder");
  const start = source.indexOf(marker);
  function replace(bytes) {
    return Buffer.concat([
      source.subarray(0, start - 2),
      numberBytes(2, "writeUInt16BE", bytes.length),
      Buffer.from(bytes),
      source.subarray(start + marker.length),
    ]);
  }
  const modified = [0x68, 0x69, 0xc0, 0x80, 0xed, 0xa0, 0xbc, 0xed, 0xbf, 0xa0];
  assert.equal(parseLitematicData(replace(modified)).name, "hi\0🏠");
  for (const malformed of [[0xc0], [0xc0, 0x81], [0xe0, 0x80, 0x80], [0xff]]) {
    assert.throws(
      () => parseLitematicData(replace(malformed)),
      category("invalid")
    );
  }
});

test("required NBT fields enforce their declared tag types", () => {
  assert.throws(
    () => parseLitematicData(nbt(schematic(undefined, { Version: tag(5, 6) }))),
    category("invalid")
  );
  const main = region();
  main.value.Size.value.x = tag(6, 2);
  assert.throws(
    () => parseLitematicData(nbt(schematic({ main }))),
    category("invalid")
  );
});

test("gzip damage and decompression bombs return bounded useful errors", async () => {
  const zipped = gzipSync(nbt(schematic()));
  await assert.rejects(
    parseLitematic(zipped.subarray(0, zipped.length - 5)),
    category("invalid")
  );
  await assert.rejects(
    parseLitematic(Buffer.from("not gzip")),
    category("invalid")
  );
  await assert.rejects(
    parseLitematic(zipped, { compressedBytes: 16 }),
    category("too_complex")
  );
  await assert.rejects(
    parseLitematic(gzipSync(Buffer.alloc(1024 * 1024)), {
      decompressedBytes: 1024,
    }),
    category("too_complex")
  );
  assert.throws(
    () => parseLitematicData(nbt(schematic()), { decompressedBytes: 10 }),
    category("too_complex")
  );
});

test("all preview complexity limits are enforced independently", () => {
  assert.throws(
    () => parseLitematicData(nbt(schematic()), { volume: 1 }),
    category("too_complex")
  );
  assert.throws(
    () =>
      parseLitematicData(
        nbt(schematic({ main: region({ indices: [1, 1] }) })),
        { blocks: 1 }
      ),
    category("too_complex")
  );
  assert.throws(
    () => parseLitematicData(nbt(schematic()), { dimension: 1 }),
    category("too_complex")
  );
  assert.throws(
    () => parseLitematicData(nbt(schematic()), { palette: 1 }),
    category("too_complex")
  );
  assert.throws(
    () =>
      parseLitematicData(nbt(schematic({ a: region(), b: region() })), {
        regions: 1,
      }),
    category("too_complex")
  );
  assert.throws(
    () =>
      parseLitematicData(
        nbt(schematic({ a: region(), b: region({ position: [2048, 0, 0] }) }))
      ),
    category("too_complex")
  );
  assert.throws(
    () =>
      parseLitematicData(
        nbt(schematic({ giant: region({ size: [2049, 1, 1] }) }))
      ),
    category("too_complex")
  );
  assert.throws(
    () =>
      parseLitematicData(
        nbt(schematic({ giant: region({ size: [200, 200, 200] }) }))
      ),
    category("too_complex")
  );
  assert.throws(
    () =>
      parseLitematicData(
        nbt(schematic({ giant: region({ size: [2049, 1, 1] }) })),
        { dimension: DEFAULT_LIMITS.dimension * 2 }
      ),
    category("too_complex")
  );
});

test("malformed palettes, positions, zero sizes and packed references are rejected", () => {
  const badReference = region({
    names: ["minecraft:air", "minecraft:stone"],
    indices: [0, 3],
  });
  const badLength = region();
  badLength.value.BlockStates = tag(12, []);
  const badPalette = region({ names: ["invalid block", "minecraft:stone"] });
  const badProperty = region();
  badProperty.value.BlockStatePalette.value.items[0].Properties = compound({
    facing: int(1),
  });
  const zero = region({ size: [0, 1, 1] });
  const badPosition = region();
  badPosition.value.Position = string("wrong type");
  for (const main of [
    badReference,
    badLength,
    badPalette,
    badProperty,
    zero,
    badPosition,
  ]) {
    assert.throws(
      () => parseLitematicData(nbt(schematic({ main }))),
      category("invalid")
    );
  }
  assert.throws(
    () => parseLitematicData(nbt(schematic({}))),
    category("invalid")
  );
});

test("semantic block identifiers and properties are bounded before crossing the worker boundary", () => {
  const oversized = [
    { names: [`mod:${"b".repeat(509)}`, "minecraft:air"] },
    {
      properties: {
        0: Object.fromEntries(
          Array.from({ length: 65 }, (_, i) => [`property_${i}`, "true"])
        ),
      },
    },
    { properties: { 0: { ["k".repeat(129)]: "true" } } },
    { properties: { 0: { key: "v".repeat(257) } } },
  ];
  for (const options of oversized) {
    assert.throws(
      () => parseLitematicData(nbt(schematic({ main: region(options) }))),
      category("too_complex")
    );
  }
  const longIdentifier = `some_large_mod:${"decorative_block_".repeat(20)}`;
  const scene = parseLitematicData(
    nbt(
      schematic({
        main: region({
          names: [longIdentifier, "minecraft:air"],
          indices: [0, 0],
          properties: { 0: { facing: "north", connection: "connected" } },
        }),
      })
    )
  );
  assert.equal(scene.materials[0].name, longIdentifier);
  assert.equal(scene.blockCount, 2);
});
