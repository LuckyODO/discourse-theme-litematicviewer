import {
  AmbientLight,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  ATLAS_IMAGE_BASE64,
  ATLAS_SIZE,
  TEXTURE_VERSION,
} from "./generated/atlas-image.mjs";
import { createTransparentSorter } from "./transparent-sorter.mjs";

const DEFAULT_LABELS = {
  canvas_label: "Interactive 3D preview",
  reset: "Reset view",
  zoom_in: "Zoom in",
  zoom_out: "Zoom out",
  layer: "Layer",
  all_layers: "All layers",
  materials: "Materials",
  more_materials: "more block types",
  blocks: "blocks",
  dimensions: "Dimensions",
  basic_models: "Vanilla block models and textures",
  fallback_models: "blocks use fallback models",
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/** No remote resources, persistent file cache, or continuous animation loop. */
export function create({
  container,
  buffer,
  workerUrl,
  theme,
  labels = {},
  onReady,
  onError,
}) {
  const copy = { ...DEFAULT_LABELS, ...labels };
  const root = element("div", "litematic-viewer");
  const header = element("div", "litematic-viewer__header");
  const summary = element("div", "litematic-model-summary");
  const note = element("small", "litematic-model-note", copy.basic_models);
  note.title = `Minecraft Java ${TEXTURE_VERSION}`;
  const viewport = element("div", "litematic-canvas");
  const toolbar = element("div", "litematic-viewer__toolbar");
  const layerLabel = element(
    "label",
    "litematic-layer-label",
    `${copy.layer} `
  );
  const layer = element("input", "litematic-layer");
  layer.type = "range";
  layer.step = "1";
  layer.disabled = true;
  layer.setAttribute("aria-label", copy.layer);
  const layerValue = element(
    "output",
    "litematic-layer-value",
    copy.all_layers
  );
  layerLabel.append(layer, layerValue);
  const materialDetails = element("details", "litematic-materials");
  materialDetails.append(element("summary", "", copy.materials));
  const materialList = element("ol", "litematic-materials__list");
  materialDetails.append(materialList);
  header.append(summary, materialDetails);
  toolbar.append(layerLabel);
  root.append(header, viewport, toolbar, note);
  container.append(root);

  let renderer,
    controls,
    worker,
    resizeObserver,
    mesh,
    grid,
    texture,
    bitmap,
    sorter;
  let stopped = false;
  let ready = false;
  let frame = 0;
  let layerTimer, layerDeadline;
  let requestedLayer = 0;
  let layerInFlight = false;
  let pendingLayer;
  let box;
  const scene = new Scene();
  const camera = new PerspectiveCamera(42, 1, 0.1, 10000);
  const material = new MeshLambertMaterial({
    vertexColors: true,
    alphaTest: 0.1,
    side: DoubleSide,
  });
  const translucentMaterial = new MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    alphaTest: 1 / 255,
    side: DoubleSide,
    forceSinglePass: true,
  });
  const cleanup = [];

  function listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    cleanup.push(() => target.removeEventListener(type, callback, options));
  }

  function destroy() {
    if (stopped) {
      return;
    }
    stopped = true;
    cancelAnimationFrame(frame);
    clearTimeout(layerTimer);
    clearTimeout(layerDeadline);
    cleanup.forEach((remove) => remove());
    resizeObserver?.disconnect();
    worker?.terminate();
    controls?.dispose();
    mesh?.geometry.dispose();
    grid?.geometry.dispose();
    grid?.material.dispose();
    material.dispose();
    translucentMaterial.dispose();
    sorter = undefined;
    texture?.dispose();
    bitmap?.close();
    renderer?.dispose();
    renderer?.forceContextLoss();
    root.remove();
  }

  function fail(category) {
    if (stopped) {
      return;
    }
    destroy();
    onError(category);
  }

  async function loadTextureAndStart() {
    try {
      // Image bytes travel in the same local theme script, including on forums
      // whose uploads use a CDN. Decoding needs no image URL or network request.
      const binary = atob(ATLAS_IMAGE_BASE64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
      }
      const decoded = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
        {
          imageOrientation: "flipY",
          premultiplyAlpha: "none",
          colorSpaceConversion: "none",
        }
      );
      // ImageBitmap decoding is not abortable. A late result still belongs to
      // this preview and must be released without reviving a closed worker.
      if (stopped) {
        decoded.close();
        return;
      }
      bitmap = decoded;
      if (
        bitmap.width !== ATLAS_SIZE[0] ||
        bitmap.height !== ATLAS_SIZE[1] ||
        Math.max(bitmap.width, bitmap.height) >
          renderer.capabilities.maxTextureSize
      ) {
        fail("configuration");
        return;
      }
      texture = new Texture(bitmap);
      texture.colorSpace = SRGBColorSpace;
      texture.magFilter = NearestFilter;
      texture.minFilter = NearestFilter;
      texture.generateMipmaps = false;
      // ImageBitmap was already flipped during decoding; WebGL ignores flipY
      // for bitmap sources. The worker's UVs use the normal bottom-up origin.
      texture.flipY = false;
      texture.needsUpdate = true;
      material.map = texture;
      material.needsUpdate = true;
      translucentMaterial.map = texture;
      translucentMaterial.needsUpdate = true;
      worker.postMessage({ type: "load", buffer }, [buffer]);
    } catch {
      fail("configuration");
    }
  }

  function render() {
    frame = 0;
    if (stopped || document.hidden || !renderer) {
      return;
    }
    if (sorter) {
      camera.updateMatrixWorld();
      if (sorter.update(camera.matrixWorldInverse.elements)) {
        mesh.geometry.index.clearUpdateRanges();
        mesh.geometry.index.addUpdateRange(sorter.offset, sorter.count);
        mesh.geometry.index.needsUpdate = true;
      }
    }
    renderer.render(scene, camera);
  }

  function invalidate() {
    if (!stopped && !frame && !document.hidden) {
      frame = requestAnimationFrame(render);
    }
  }

  function resize() {
    if (stopped) {
      return;
    }
    const { width, height } = viewport.getBoundingClientRect();
    if (!width || !height) {
      return;
    }
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    invalidate();
  }

  function reset() {
    if (!box) {
      return;
    }
    const size = box.getSize(new Vector3());
    const radius = Math.max(1, size.length() / 2);
    const center = box.getCenter(new Vector3());
    const halfFov = (camera.fov * Math.PI) / 360;
    const distance =
      (radius /
        Math.sin(Math.atan(Math.tan(halfFov) * Math.min(camera.aspect, 1)))) *
      1.12;
    camera.position
      .copy(center)
      .add(new Vector3(1, 0.8, 1).normalize().multiplyScalar(distance));
    camera.near = Math.max(0.01, radius / 1000);
    camera.far = radius * 100 + distance;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.minDistance = Math.max(0.1, radius / 100);
    controls.maxDistance = distance * 8;
    controls.update();
    invalidate();
  }

  function zoom(factor) {
    if (!controls) {
      return;
    }
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(
      Math.max(
        controls.minDistance,
        Math.min(controls.maxDistance, offset.length() * factor)
      )
    );
    camera.position.copy(controls.target).add(offset);
    controls.update();
    invalidate();
  }

  function button(label, className, callback) {
    const node = element("button", `btn btn-default ${className}`, label);
    node.type = "button";
    listen(node, "click", callback);
    toolbar.append(node);
  }

  function sendLayer() {
    if (stopped || layerInFlight || !pendingLayer) {
      return;
    }
    clearTimeout(layerTimer);
    layerInFlight = true;
    worker.postMessage({ type: "layer", ...pendingLayer });
    pendingLayer = undefined;
    layerDeadline = setTimeout(() => fail("timeout"), 30000);
  }

  try {
    renderer = new WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    let background =
      getComputedStyle(container).getPropertyValue("--secondary").trim() ||
      "#ffffff";
    if (theme === "dark") {
      background = "#202328";
    }
    if (theme === "light") {
      background = "#f5f6f7";
    }
    scene.background = new Color(background);
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", copy.canvas_label);
    viewport.append(canvas);
    listen(canvas, "webglcontextlost", (event) => {
      event.preventDefault();
      fail("graphics");
    });
    controls = new OrbitControls(camera, canvas);
    // Event-driven rendering saves battery while the model is idle.
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.listenToKeyEvents(canvas);
    controls.addEventListener("change", invalidate);
    listen(canvas, "keydown", (event) => {
      if (["+", "=", "-", "Home"].includes(event.key)) {
        event.preventDefault();
        if (event.key === "Home") {
          reset();
        } else {
          zoom(event.key === "-" ? 1.2 : 1 / 1.2);
        }
      }
    });
    scene.add(new AmbientLight(0xffffff, 0.9));
    const sunlight = new DirectionalLight(0xffffff, 0.7);
    sunlight.position.set(-3, 8, 5);
    scene.add(sunlight);
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(viewport);
    listen(document, "visibilitychange", invalidate);
    button(copy.reset, "litematic-reset", reset);
    button(copy.zoom_in, "litematic-zoom-in", () => zoom(1 / 1.25));
    button(copy.zoom_out, "litematic-zoom-out", () => zoom(1.25));

    listen(layer, "input", () => {
      if (!ready) {
        return;
      }
      const y = Number(layer.value);
      layerValue.textContent =
        y === Number(layer.max) ? copy.all_layers : `Y ≤ ${y}`;
      layer.setAttribute("aria-valuetext", layerValue.textContent);
      requestedLayer++;
      pendingLayer = { id: requestedLayer, y };
      root.setAttribute("aria-busy", "true");
      clearTimeout(layerTimer);
      layerTimer = setTimeout(sendLayer, 120);
    });

    worker = new Worker(workerUrl);
    worker.onerror = () => fail("viewer");
    worker.onmessageerror = () => fail("viewer");
    worker.onmessage = ({ data }) => {
      if (stopped) {
        return;
      }
      if (data.type !== "mesh" && data.type !== "error") {
        return;
      }
      if (data.id > 0) {
        layerInFlight = false;
        clearTimeout(layerDeadline);
      }
      if (data.id !== requestedLayer) {
        sendLayer();
        return;
      }
      if (data.type === "error") {
        fail(data.category);
        return;
      }
      try {
        const geometry = new BufferGeometry();
        geometry.setAttribute(
          "position",
          new BufferAttribute(data.positions, 3)
        );
        geometry.setAttribute("normal", new BufferAttribute(data.normals, 3));
        geometry.setAttribute("color", new BufferAttribute(data.colors, 3));
        geometry.setAttribute("uv", new BufferAttribute(data.uvs, 2));
        const opaqueFaces = data.opaqueFaceCount ?? data.faceCount;
        const translucentFaces = data.translucentFaceCount ?? 0;
        sorter = translucentFaces
          ? createTransparentSorter(
              data.positions,
              opaqueFaces,
              translucentFaces
            )
          : undefined;
        if (sorter) {
          geometry.setIndex(new BufferAttribute(sorter.indices, 1));
        }
        geometry.addGroup(0, opaqueFaces * 6, 0);
        if (translucentFaces) {
          geometry.addGroup(opaqueFaces * 6, translucentFaces * 6, 1);
        }
        // The worker rebases coordinates before Float32 conversion, including large offsets.
        if (!box) {
          box = new Box3(
            new Vector3(),
            new Vector3(...data.bounds.max).sub(new Vector3(...data.bounds.min))
          );
        }
        const center = box.getCenter(new Vector3());
        if (mesh) {
          scene.remove(mesh);
          mesh.geometry.dispose();
        }
        mesh = new Mesh(geometry, [material, translucentMaterial]);
        // The grid is a translucent helper under the structure; surfaces blend
        // over it. All block faces stay in at most two batched draw calls.
        mesh.renderOrder = 2;
        scene.add(mesh);
        root.removeAttribute("aria-busy");
        clearTimeout(layerDeadline);
        if (!ready) {
          ready = true;
          const size = box.getSize(new Vector3());
          summary.textContent = `${data.blockCount.toLocaleString()} ${copy.blocks} · ${size.x} × ${size.y} × ${size.z}`;
          summary.dataset.blockCount = String(data.blockCount);
          summary.title = copy.dimensions;
          const fallbackCount = data.fallbackBlockCount || 0;
          note.textContent =
            copy.basic_models +
            (fallbackCount
              ? ` · ${fallbackCount.toLocaleString()} ${copy.fallback_models}`
              : "");
          layer.min = String(data.bounds.min[1]);
          layer.max = String(data.bounds.max[1] - 1);
          layer.value = layer.max;
          layer.disabled = layer.min === layer.max;
          layer.setAttribute("aria-valuetext", copy.all_layers);
          // A long material list is scrollable and uses textContent for untrusted block IDs.
          for (const entry of data.materials.slice(0, 200)) {
            const row = element("li", "");
            row.append(
              element("span", "", entry.name.replace(/^minecraft:/, "")),
              element("span", "", entry.count.toLocaleString())
            );
            materialList.append(row);
          }
          if (data.materials.length > 200) {
            materialList.append(
              element(
                "li",
                "",
                `+${data.materials.length - 200} ${copy.more_materials}`
              )
            );
          }
          const gridSize = Math.max(size.x, size.z, 4) * 1.25;
          grid = new GridHelper(
            gridSize,
            Math.min(64, Math.ceil(gridSize)),
            0x8d969d,
            0xb2bac0
          );
          grid.position.set(center.x, box.min.y - 0.03, center.z);
          grid.material.transparent = true;
          grid.material.opacity = 0.25;
          grid.renderOrder = 1;
          scene.add(grid);
          resize();
          reset();
          cancelAnimationFrame(frame);
          render();
          onReady();
        } else {
          invalidate();
        }
      } catch {
        fail("viewer");
      }
    };
    loadTextureAndStart();
  } catch {
    fail(renderer ? "viewer" : "graphics");
  }

  return { destroy };
}

globalThis.DiscourseLitematic = { create };
