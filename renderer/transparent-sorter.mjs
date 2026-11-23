/* eslint-disable no-bitwise -- Float depth keys are sorted with a bounded radix pass. */

/** Reorders only transparent quad indices. Geometry and GPU attributes stay put.
 * Four linear passes avoid comparison sorting and per-face object allocation. */
export function createTransparentSorter(
  positions,
  opaqueFaceCount,
  translucentFaceCount
) {
  const totalFaces = positions.length / 18;
  if (
    !Number.isSafeInteger(totalFaces) ||
    !Number.isSafeInteger(opaqueFaceCount) ||
    !Number.isSafeInteger(translucentFaceCount) ||
    opaqueFaceCount < 0 ||
    translucentFaceCount < 1 ||
    opaqueFaceCount + translucentFaceCount !== totalFaces
  ) {
    throw new Error("Invalid transparent geometry ranges.");
  }
  const indices = new Uint32Array(totalFaces * 6);
  for (let index = 0; index < indices.length; index++) {
    indices[index] = index;
  }
  const centers = new Float32Array(translucentFaceCount * 3);
  for (let face = 0; face < translucentFaceCount; face++) {
    const start = (opaqueFaceCount + face) * 18;
    for (let axis = 0; axis < 3; axis++) {
      let sum = 0;
      for (let vertex = 0; vertex < 6; vertex++) {
        sum += positions[start + vertex * 3 + axis];
      }
      centers[face * 3 + axis] = sum / 6;
    }
  }
  const keys = new Uint32Array(translucentFaceCount);
  const floatKeys = new Float32Array(keys.buffer);
  let order = new Uint32Array(translucentFaceCount);
  let scratch = new Uint32Array(translucentFaceCount);
  const buckets = new Uint32Array(256);
  const previous = new Float64Array(16);
  let initialized = false;

  function update(view) {
    if (
      initialized &&
      previous.every((value, index) => value === view[index])
    ) {
      return false;
    }
    previous.set(view);
    initialized = true;
    for (let face = 0; face < translucentFaceCount; face++) {
      const offset = face * 3;
      // Camera space looks down -Z; greater positive depth must blend first.
      floatKeys[face] = -(
        view[2] * centers[offset] +
        view[6] * centers[offset + 1] +
        view[10] * centers[offset + 2] +
        view[14]
      );
      const bits = keys[face];
      keys[face] = ~(bits & 0x80000000 ? ~bits : bits ^ 0x80000000);
      order[face] = face;
    }
    for (let shift = 0; shift < 32; shift += 8) {
      buckets.fill(0);
      for (let index = 0; index < order.length; index++) {
        buckets[(keys[order[index]] >>> shift) & 255]++;
      }
      let cursor = 0;
      for (let bucket = 0; bucket < buckets.length; bucket++) {
        const length = buckets[bucket];
        buckets[bucket] = cursor;
        cursor += length;
      }
      for (let index = 0; index < order.length; index++) {
        const face = order[index];
        scratch[buckets[(keys[face] >>> shift) & 255]++] = face;
      }
      const swap = order;
      order = scratch;
      scratch = swap;
    }
    let offset = opaqueFaceCount * 6;
    for (const face of order) {
      const firstVertex = (opaqueFaceCount + face) * 6;
      for (let vertex = 0; vertex < 6; vertex++) {
        indices[offset++] = firstVertex + vertex;
      }
    }
    return true;
  }

  return {
    indices,
    update,
    offset: opaqueFaceCount * 6,
    count: translucentFaceCount * 6,
  };
}
