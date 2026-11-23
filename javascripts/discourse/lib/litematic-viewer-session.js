const PROTOCOL = "litematic-preview-v1";
const VIEWER_MAX_BYTES = 64 * 1024 * 1024;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const GZIP_PREFIX = [0x1f, 0x8b, 0x08];

class PreviewError extends Error {
  constructor(category) {
    super(category);
    this.category = category;
  }
}

function checkedURL(value, base, viewer = false) {
  if (typeof value !== "string" || !value.trim()) {
    throw new PreviewError("configuration");
  }
  const url = new URL(value, base);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (base.protocol === "https:" && url.protocol !== "https:") ||
    (viewer && url.protocol !== "https:" && !LOCAL_HOSTS.has(url.hostname))
  ) {
    throw new PreviewError("configuration");
  }
  return url;
}

function percent(value) {
  return Math.max(0, Math.min(100, value));
}

/** Owns one authenticated download and one isolated viewer, until destroyed. */
export function createViewerSession({
  container,
  url,
  name,
  viewerUrl,
  maxBytes = VIEWER_MAX_BYTES,
  timeoutMs = 60000,
  lang = "en",
  theme = "light",
  title,
  onStatus,
  onClose,
}) {
  const controller = new AbortController();
  let iframe;
  let viewer;
  let timer;
  let channel;
  let file;
  let viewerReady = false;
  let sent = false;
  let stopped = false;
  let phase = "download";

  function status(state, details = {}) {
    onStatus?.({ state, phase, ...details });
  }

  function destroy() {
    if (stopped) {
      return;
    }
    stopped = true;
    controller.abort();
    clearTimeout(timer);
    window.removeEventListener("message", receive);
    document.removeEventListener("visibilitychange", visibilityChanged);
    iframe?.remove();
    iframe = undefined;
    file = undefined;
  }

  function fail(category) {
    if (stopped) {
      return;
    }
    destroy();
    status("error", { error: category });
  }

  function post(message) {
    if (!stopped && viewerReady) {
      iframe.contentWindow.postMessage(
        { protocol: PROTOCOL, channel, ...message },
        viewer.origin
      );
    }
  }

  function visibilityChanged() {
    try {
      post({ type: "active", active: !document.hidden });
    } catch {
      fail("viewer");
    }
  }

  function loadWhenReady() {
    if (stopped || !viewerReady || !file || sent) {
      return;
    }
    sent = true;
    phase = "viewer";
    try {
      post({
        type: "configure",
        options: {
          lang,
          theme,
          viewer: {
            header: false,
            panels: { file: false },
            tools: { catalog: false, export: false, help: false, packs: false },
          },
        },
      });
      post({ type: "active", active: !document.hidden });
      post({ type: "load", file });
      file = undefined;
      status("loading", { progress: 0 });
    } catch {
      fail("viewer");
    }
  }

  function receive(event) {
    const data = event.data;
    if (
      stopped ||
      !iframe ||
      event.source !== iframe.contentWindow ||
      event.origin !== viewer.origin ||
      data?.protocol !== PROTOCOL ||
      data.channel !== channel
    ) {
      return;
    }
    if (data.type === "ready") {
      viewerReady = true;
      loadWhenReady();
    } else if (data.type === "close-request") {
      destroy();
      onClose?.();
    } else if (data.type === "error") {
      phase = "viewer";
      fail("viewer");
    } else if (sent && data.type === "loaded") {
      clearTimeout(timer);
      status("ready", { progress: 100 });
    } else if (sent && data.type === "loading") {
      status(
        "loading",
        Number.isFinite(data.progress)
          ? { progress: percent(data.progress * 100) }
          : {}
      );
    }
  }

  async function download(source, limit) {
    try {
      const response = await fetch(source.href, {
        credentials:
          source.origin === window.location.origin ? "same-origin" : "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (stopped) {
        await response.body?.cancel();
        return;
      }
      if (!response.ok) {
        throw new PreviewError("download");
      }
      if (
        /(?:text\/html|application\/xhtml\+xml)/i.test(
          response.headers.get("content-type") || ""
        )
      ) {
        throw new PreviewError("download");
      }
      const declaredSize = Number(response.headers.get("content-length"));
      if (declaredSize > limit) {
        throw new PreviewError("too_large");
      }
      if (!response.body) {
        throw new PreviewError("empty");
      }
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      let prefixBytes = 0;
      let lastProgress = 0;
      try {
        while (!stopped) {
          const { done, value } = await reader.read();
          if (stopped) {
            return;
          }
          if (done) {
            break;
          }
          size += value.byteLength;
          if (size > limit) {
            throw new PreviewError("too_large");
          }
          // Check only the compression signature; the viewer parses the NBT.
          for (
            let index = 0;
            index < value.byteLength && prefixBytes < GZIP_PREFIX.length;
            index++, prefixBytes++
          ) {
            if (value[index] !== GZIP_PREFIX[prefixBytes]) {
              throw new PreviewError("invalid");
            }
          }
          chunks.push(value);
          if (declaredSize > 0) {
            const progress = Math.floor(percent((size / declaredSize) * 100));
            if (progress !== lastProgress) {
              lastProgress = progress;
              status("loading", { progress });
            }
          }
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
      if (stopped) {
        return;
      }
      if (!size) {
        throw new PreviewError("empty");
      }
      if (prefixBytes !== GZIP_PREFIX.length) {
        throw new PreviewError("invalid");
      }
      file = new File(chunks, name || "schematic.litematic", {
        type: "application/octet-stream",
      });
      phase = "viewer";
      status("loading");
      loadWhenReady();
    } catch (error) {
      if (!stopped) {
        fail(error instanceof PreviewError ? error.category : "download");
      }
    }
  }

  try {
    const base = new URL(window.location.href);
    const source = checkedURL(url, base);
    viewer = checkedURL(viewerUrl, base, true);
    if (
      !Number.isFinite(maxBytes) ||
      maxBytes <= 0 ||
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0 ||
      !["en", "zh"].includes(lang) ||
      !["light", "dark", "auto"].includes(theme) ||
      !container?.appendChild
    ) {
      throw new PreviewError("configuration");
    }
    if (viewer.pathname.endsWith("/")) {
      viewer.pathname += "index.html";
    }
    viewer.hash = "";
    viewer.searchParams.delete("file");
    viewer.searchParams.delete("appearance");
    channel = crypto.randomUUID();
    viewer.searchParams.set("embedded", "1");
    viewer.searchParams.set("parentOrigin", base.origin);
    viewer.searchParams.set("channel", channel);
    viewer.searchParams.set("lang", lang);
    viewer.searchParams.set("pack", "vanilla");

    iframe = document.createElement("iframe");
    iframe.title = title || name || "Litematic 3D preview";
    iframe.className = "litematic-viewer-frame";
    iframe.referrerPolicy = "no-referrer";
    iframe.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-downloads"
    );
    iframe.setAttribute("allow", "fullscreen");
    iframe.src = viewer.href;

    window.addEventListener("message", receive);
    document.addEventListener("visibilitychange", visibilityChanged);
    timer = setTimeout(() => fail("timeout"), timeoutMs);
    container.appendChild(iframe);
    status("loading", { progress: 0 });
    download(source, Math.min(maxBytes, VIEWER_MAX_BYTES));
  } catch {
    fail("configuration");
  }

  return { destroy };
}
