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
window.previewEvents = [];

function close() {
  session?.destroy();
  session = undefined;
  modal.close();
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
  session = createViewerSession({
    container: stage,
    url: attachmentURL(anchor),
    name,
    viewerUrl: params.has("live")
      ? "https://lwv.loafing.club/index.html"
      : `http://127.0.0.1:${location.port}/test/browser/mock-viewer.html?mode=${params.get("mode") || "success"}`,
    maxBytes: params.has("small") ? 16 : 32 * 1024 * 1024,
    timeoutMs: params.has("timeout") ? 300 : 90000,
    lang: "zh",
    theme: "light",
    onClose: close,
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
