import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BLOCK_MODELS } from "../../renderer/generated/block-models.mjs";
import {
  buildModelData,
  compileModelSources,
  readModelSources,
} from "../../scripts/build-models.mjs";

const sources = (files) =>
  new Map(
    Object.entries(files).map(([name, value]) => [
      name,
      Buffer.from(JSON.stringify(value)),
    ])
  );

test("offline model sources reproduce the committed shared model data", async () => {
  const files = await readModelSources();
  assert.equal(files.size, 4171);
  const { data, bytes } = await buildModelData();
  assert.deepEqual(data, BLOCK_MODELS);
  assert.deepEqual(
    bytes,
    await readFile(
      new URL("../../renderer/generated/block-models.mjs", import.meta.url)
    )
  );
  assert.ok(bytes.length < 2 * 1024 * 1024);
  assert.equal(Object.keys(data.states).length, 1288);
  assert.ok(data.geometries.length < data.models.length / 5);
});

test("parent geometry uses child texture overrides and preserves translucent texture declarations", () => {
  const files = sources({
    "models/block/base.json": {
      textures: { all: "block/stone", side: "#all" },
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 16, 16],
          faces: { up: { texture: "#side" } },
        },
      ],
    },
    "models/block/child.json": {
      parent: "minecraft:block/base",
      textures: {
        all: { sprite: "minecraft:block/glass", force_translucent: true },
      },
    },
    "blockstates/fixture.json": {
      variants: {
        "lit=false": { model: "minecraft:block/base" },
        "lit=true": { model: "minecraft:block/child", x: 90, uvlock: true },
      },
    },
  });
  const data = compileModelSources(files);
  assert.equal(data.geometries.length, 1);
  assert.equal(data.models.length, 2);
  const child = data.models[data.states.fixture.variants[1][1].model];
  assert.deepEqual(child.textures.side, {
    sprite: "block/glass",
    translucent: true,
  });
  assert.equal(data.states.fixture.variants[1][1].x, 90);
});

test("model parent cycles, missing parents and texture alias cycles fail during the build", () => {
  const state = {
    "blockstates/fixture.json": { variants: { "": { model: "block/a" } } },
  };
  assert.throws(
    () =>
      compileModelSources(
        sources({
          ...state,
          "models/block/a.json": { parent: "block/b" },
          "models/block/b.json": { parent: "block/a" },
        })
      ),
    /Cyclic model parent/
  );
  assert.throws(
    () =>
      compileModelSources(
        sources({
          ...state,
          "models/block/a.json": { parent: "block/missing" },
        })
      ),
    /Missing model parent/
  );
  assert.throws(
    () =>
      compileModelSources(
        sources({
          ...state,
          "models/block/a.json": { textures: { a: "#b", b: "#a" } },
        })
      ),
    /Cyclic model texture/
  );
});
