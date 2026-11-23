import assert from "node:assert/strict";
import test from "node:test";
import { parseLitematic } from "../../renderer/litematic-parser.mjs";
import { buildMesh } from "../../renderer/mesh.mjs";
import { encodeLitematicFixture } from "../fixtures/litematic-fixture.mjs";
import { createSpecialShowcaseFixture } from "../fixtures/special-showcase.mjs";

test("real gzip special-block showcase builds finite original meshes with no fallback", async () => {
  const scene = await parseLitematic(createSpecialShowcaseFixture());
  const mesh = buildMesh(scene);
  assert.equal(scene.blockCount, 230);
  assert.equal(
    scene.materials.reduce((sum, material) => sum + material.count, 0),
    230
  );
  assert.equal(mesh.fallbackBlockCount, 0);
  assert.deepEqual(mesh.unsupportedNames, []);
  for (const key of ["positions", "normals", "uvs", "colors"]) {
    assert.ok(mesh[key].every(Number.isFinite), key);
  }
  assert.ok(mesh.uvs.every((value) => value >= 0 && value <= 1));
  assert.equal(
    mesh.opaqueFaceCount + mesh.translucentFaceCount,
    mesh.faceCount
  );
  const base = buildMesh(scene, 0);
  assert.equal(base.fallbackBlockCount, 0);
  assert.ok(base.faceCount < mesh.faceCount);
});

test("identical banner palette states preserve different per-position patterns through layer rebuilds", async () => {
  const fixture = (different) =>
    encodeLitematicFixture({
      name: "Pattern cache",
      regionName: "Banners",
      size: { x: 3, y: 1, z: 1 },
      palette: [
        { name: "air" },
        { name: "white_banner", properties: { rotation: "0" } },
      ],
      blocks: [1, 0, 1],
      tileEntities: [
        {
          x: 0,
          y: 0,
          z: 0,
          patterns: [{ color: "red", pattern: "minecraft:stripe_center" }],
        },
        {
          x: 2,
          y: 0,
          z: 0,
          patterns: [
            {
              color: different ? "blue" : "red",
              pattern: "minecraft:stripe_center",
            },
          ],
        },
      ],
    });
  const scene = await parseLitematic(fixture(true));
  const different = buildMesh(scene);
  const same = buildMesh(await parseLitematic(fixture(false)));
  assert.deepEqual(different.positions, same.positions);
  assert.deepEqual(different.uvs, same.uvs);
  assert.notDeepEqual(different.colors, same.colors);
  assert.deepEqual(buildMesh(scene, 0).colors, different.colors);
  assert.equal(buildMesh(scene, -1).faceCount, 0);
});
