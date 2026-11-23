import {
  attachmentURL,
  decorateAttachments,
} from "/javascripts/discourse/lib/litematic-attachments.js";
import { createViewerSession } from "/javascripts/discourse/lib/litematic-viewer-session.js";

const params = new URLSearchParams(location.search);
const modal = document.querySelector("dialog");
const stage = document.querySelector(".litematic-preview__stage");
const status = document.querySelector(".litematic-preview__status");
const text = document.querySelector("#status-text");
const progress = document.querySelector("#progress");
const retry = document.querySelector("#retry");
let session;
let selected;
let rendererPromise;
window.previewEvents = [];

function loadRenderer() {
  if (window.DiscourseLitematic) {
    return Promise.resolve(window.DiscourseLitematic);
  }
  if (!rendererPromise) {
    rendererPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/assets/litematic-renderer.js";
      script.onload = () => resolve(window.DiscourseLitematic);
      script.onerror = () => {
        script.remove();
        rendererPromise = undefined;
        reject(new Error("The bundled renderer could not be loaded"));
      };
      document.head.append(script);
    });
  }
  return rendererPromise;
}

function close() {
  session?.destroy();
  session = undefined;
  modal.close();
  selected?.anchor.parentElement
    ?.querySelector(".litematic-attachment__preview")
    ?.focus();
}

function open(item) {
  selected = item;
  session?.destroy();
  const { anchor, name } = item;
  document.querySelector("#preview-title").textContent = name;
  const download = document.querySelector(".litematic-preview__download");
  download.href = attachmentURL(anchor);
  download.download = name;
  if (!modal.open) {
    modal.showModal();
  }
  const source = new URL(attachmentURL(anchor));
  if (params.has("slow")) {
    source.searchParams.set("slow", "1");
  }
  session = createViewerSession({
    container: stage,
    url: source.href,
    workerUrl: "/assets/litematic-worker.js",
    loadRenderer,
    maxBytes: params.has("small") ? 16 : 32 * 1024 * 1024,
    timeoutMs: params.has("timeout") ? 300 : 90000,
    theme: "light",
    labels: {
      canvas_label: "可交互的 3D 预览",
      reset: "重置视角",
      zoom_in: "放大",
      zoom_out: "缩小",
      layer: "分层",
      all_layers: "全部层",
      materials: "材料",
      more_materials: "种其他方块",
      blocks: "个方块",
      dimensions: "尺寸",
      basic_models: "原版材质 · 部分模型已简化",
    },
    onStatus(event) {
      window.previewEvents.push(event);
      modal.dataset.state = event.state;
      modal.dataset.error = event.error || "";
      status.hidden = event.state === "ready";
      retry.hidden = event.state !== "error";
      progress.hidden = event.state === "error";
      text.textContent =
        event.state === "error"
          ? `预览暂不可用（${event.error}），仍可下载文件。`
          : event.phase === "download"
            ? "正在下载投影文件…"
            : "正在准备 3D 预览…";
      if (Number.isFinite(event.progress)) {
        progress.max = 100;
        progress.value = event.progress;
      } else {
        progress.removeAttribute("value");
      }
    },
  });
}

document.querySelector("#close").addEventListener("click", close);
modal.addEventListener("cancel", (event) => {
  event.preventDefault();
  close();
});
retry.addEventListener("click", () => open(selected));
const options = {
  labels: { preview: "3D 预览", download: "下载" },
  onPreview: open,
};
let restore = decorateAttachments(document.querySelector(".cooked"), options);
window.redecorate = () => {
  restore();
  restore = decorateAttachments(document.querySelector(".cooked"), options);
};
window.addEventListener("pagehide", () => session?.destroy());
