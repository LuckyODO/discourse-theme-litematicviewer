import assert from "node:assert/strict";
import test from "node:test";
import { createTransparentSorter } from "../../renderer/transparent-sorter.mjs";

const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function quads(points) {
  return Float32Array.from(
    points.flatMap((point) => Array(6).fill(point).flat())
  );
}

test("transparent quads blend far to near without changing opaque indices or vertices", () => {
  const positions = quads([
    [0, 0, -9],
    [0, 0, -2],
    [0, 0, -8],
    [0, 0, -4],
  ]);
  const original = positions.slice();
  const sorter = createTransparentSorter(positions, 1, 3);
  assert.equal(sorter.update(view), true);
  assert.deepEqual([...sorter.indices.slice(0, 6)], [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(
    [sorter.indices[6], sorter.indices[12], sorter.indices[18]],
    [12, 18, 6]
  );
  assert.deepEqual(positions, original);
  assert.equal(
    sorter.update(view),
    false,
    "idle frames must not sort or upload indices"
  );
});

test("camera rotation reverses overlapping transparent faces and keeps equal-depth ties stable", () => {
  const sorter = createTransparentSorter(
    quads([
      [0, 0, -2],
      [0, 0, -8],
      [0, 0, -8],
    ]),
    0,
    3
  );
  sorter.update(view);
  assert.deepEqual(
    [sorter.indices[0], sorter.indices[6], sorter.indices[12]],
    [6, 12, 0]
  );
  const reversed = [...view];
  reversed[0] = -1;
  reversed[10] = -1;
  assert.equal(sorter.update(reversed), true);
  assert.deepEqual(
    [sorter.indices[0], sorter.indices[6], sorter.indices[12]],
    [0, 6, 12]
  );
});

test("radix ordering handles negative and positive camera depths", () => {
  const sorter = createTransparentSorter(
    quads([
      [0, 0, 2],
      [0, 0, -1],
      [0, 0, 0],
      [0, 0, -10],
    ]),
    0,
    4
  );
  sorter.update(view);
  assert.deepEqual(
    [
      sorter.indices[0],
      sorter.indices[6],
      sorter.indices[12],
      sorter.indices[18],
    ],
    [18, 6, 12, 0]
  );
});

test("a large transparent surface reuses the index storage across viewpoint changes", () => {
  const count = 32768;
  const positions = new Float32Array(count * 18);
  for (let face = 0; face < count; face++) {
    for (let vertex = 0; vertex < 6; vertex++) {
      positions[face * 18 + vertex * 3 + 2] = -face;
    }
  }
  const sorter = createTransparentSorter(positions, 0, count);
  const indices = sorter.indices;
  sorter.update(view);
  assert.equal(indices[0], (count - 1) * 6);
  assert.equal(indices.at(-1), 5);
  sorter.update(view.map((value, index) => (index === 14 ? 10 : value)));
  assert.equal(sorter.indices, indices);
  assert.equal(indices[0], (count - 1) * 6);
});
