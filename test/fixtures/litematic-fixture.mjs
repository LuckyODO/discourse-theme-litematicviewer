/* eslint-disable no-bitwise -- Litematic stores palette indices in packed bit arrays. */
import { gzipSync } from "node:zlib";

// Original synthetic pavilion; this fixture contains block IDs, not game assets.
// Each palette index is packed continuously, least-significant bits first.
export function createLitematicFixture() {
  const text = (value) => {
    const bytes = Buffer.from(value);
    const size = Buffer.alloc(2);
    size.writeUInt16BE(bytes.length);
    return Buffer.concat([size, bytes]);
  };
  const int = (value) => {
    const bytes = Buffer.alloc(4);
    bytes.writeInt32BE(value);
    return bytes;
  };
  const tag = (type, name, payload) =>
    Buffer.concat([Buffer.from([type]), text(name), payload]);
  const compound = (tags) => Buffer.concat([...tags, Buffer.from([0])]);
  const vector = (name, x, y, z) =>
    tag(
      10,
      name,
      compound([tag(3, "x", int(x)), tag(3, "y", int(y)), tag(3, "z", int(z))])
    );
  const string = (name, value) => tag(8, name, text(value));
  const palette = [
    "air",
    "grass_block",
    "stone_bricks",
    "oak_log",
    "white_concrete",
    "red_concrete",
  ];
  const size = { x: 9, y: 7, z: 9 };
  const blocks = new Array(size.x * size.y * size.z).fill(0);
  const put = (x, y, z, block) =>
    (blocks[x + size.x * (z + size.z * y)] = block);
  for (let x = 0; x < 9; x++) {
    for (let z = 0; z < 9; z++) {
      put(x, 0, z, 1);
      if (x >= 1 && x <= 7 && z >= 1 && z <= 7) {
        put(x, 1, z, 2);
      }
      if (x >= 1 && x <= 7 && z >= 1 && z <= 7) {
        put(x, 5, z, 5);
      }
      if (x >= 2 && x <= 6 && z >= 2 && z <= 6) {
        put(x, 6, z, 5);
      }
    }
  }
  for (const x of [2, 6]) {
    for (const z of [2, 6]) {
      for (let y = 2; y <= 4; y++) {
        put(x, y, z, 3);
      }
    }
  }
  put(4, 2, 4, 4);
  const words = new Array(Math.ceil((blocks.length * 3) / 64)).fill(0n);
  blocks.forEach((block, index) => {
    const bit = index * 3;
    const word = Math.floor(bit / 64);
    const offset = BigInt(bit % 64);
    words[word] |= BigInt(block) << offset;
    if (offset > 61n) {
      words[word + 1] |= BigInt(block) >> (64n - offset);
    }
  });
  const packed = Buffer.alloc(words.length * 8);
  words.forEach((word, index) =>
    packed.writeBigUInt64BE(BigInt.asUintN(64, word), index * 8)
  );
  const region = compound([
    vector("Position", 0, 0, 0),
    vector("Size", size.x, size.y, size.z),
    tag(
      9,
      "BlockStatePalette",
      Buffer.concat([
        Buffer.from([10]),
        int(palette.length),
        ...palette.map((name) =>
          compound([string("Name", `minecraft:${name}`)])
        ),
      ])
    ),
    tag(12, "BlockStates", Buffer.concat([int(words.length), packed])),
    tag(9, "Entities", Buffer.concat([Buffer.from([10]), int(0)])),
    tag(9, "TileEntities", Buffer.concat([Buffer.from([10]), int(0)])),
  ]);
  const metadata = compound([
    string("Name", "Synthetic pavilion"),
    string("Author", "Litematic Viewer tests"),
    string("Description", "Original generated test fixture"),
    tag(3, "RegionCount", int(1)),
    tag(3, "TotalVolume", int(blocks.length)),
    tag(3, "TotalBlocks", int(blocks.filter(Boolean).length)),
    vector("EnclosingSize", size.x, size.y, size.z),
  ]);
  return gzipSync(
    tag(
      10,
      "",
      compound([
        tag(3, "Version", int(6)),
        tag(3, "SubVersion", int(1)),
        tag(3, "MinecraftDataVersion", int(3700)),
        tag(10, "Metadata", metadata),
        tag(10, "Regions", compound([tag(10, "Pavilion", region)])),
      ])
    )
  );
}
