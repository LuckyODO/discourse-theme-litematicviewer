import { parseLitematic } from "./litematic-parser.mjs";
import { buildMesh } from "./mesh.mjs";

let scene;
let loading = false;
let pendingLayer;
let layerTimer;

function reportError(error, id) {
  self.postMessage({
    type: "error",
    id,
    category: error.category || "invalid",
    message: error.message || "Could not read the schematic.",
  });
}

function sendMesh(id, y) {
  self.postMessage({ type: "progress", phase: "mesh", id });
  const mesh = buildMesh(scene, y);
  const message = {
    ...mesh,
    type: "mesh",
    id,
    bounds: scene.bounds,
    blockCount: scene.blockCount,
    materials: scene.materials,
    version: scene.version,
    name: scene.name,
  };
  const transfers = [];
  for (const value of Object.values(mesh)) {
    if (ArrayBuffer.isView(value) && !transfers.includes(value.buffer)) {
      transfers.push(value.buffer);
    }
  }
  self.postMessage(message, transfers);
}

self.addEventListener("message", async ({ data }) => {
  if (!data || typeof data !== "object") {
    return;
  }
  const id = Number.isSafeInteger(data.id) ? data.id : 0;
  try {
    if (data.type === "load") {
      if (loading || scene) {
        return;
      }
      loading = true;
      self.postMessage({ type: "progress", phase: "parse", id });
      scene = await parseLitematic(data.buffer);
      loading = false;
      sendMesh(id, Infinity);
    } else if (data.type === "layer" && scene) {
      const y = data.y;
      if (typeof y !== "number" || (!Number.isFinite(y) && y !== Infinity)) {
        return;
      }
      // While one mesh is being built, slider messages can accumulate. Yield
      // once so the queued messages replace each other before the next build.
      pendingLayer = { id, y };
      if (layerTimer === undefined) {
        layerTimer = setTimeout(() => {
          layerTimer = undefined;
          const layer = pendingLayer;
          pendingLayer = undefined;
          try {
            sendMesh(layer.id, layer.y);
          } catch (error) {
            reportError(error, layer.id);
          }
        }, 0);
      }
    }
  } catch (error) {
    loading = false;
    reportError(error, id);
  }
});
