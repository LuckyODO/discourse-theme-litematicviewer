const VIEWER_MAX_BYTES = 64 * 1024 * 1024;
const GZIP_PREFIX = [0x1f, 0x8b, 0x08];
const ERROR_CATEGORIES = new Set([
  "invalid",
  "too_complex",
  "unsupported",
  "graphics",
  "configuration",
  "viewer",
  "timeout",
]);

class PreviewError extends Error {
  constructor(category) {
    super(category);
    this.category = category;
  }
}

function checkedURL(value, base) {
  if (typeof value !== "string" || !value.trim()) {
    throw new PreviewError("configuration");
  }
  const url = new URL(value, base);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (base.protocol === "https:" && url.protocol !== "https:")
  ) {
    throw new PreviewError("configuration");
  }
  return url;
}

function percent(value) {
  return Math.max(0, Math.min(100, value));
}

/** One bounded attachment download and an on-demand, locally bundled renderer. */
export function createViewerSession({
  container,
  url,
  workerUrl,
  loadRenderer,
  labels,
  theme = "auto",
  maxBytes = VIEWER_MAX_BYTES,
  timeoutMs = 90000,
  onStatus,
}) {
  const controller = new AbortController();
  let viewer;
  let timer;
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
    viewer?.destroy();
    viewer = undefined;
  }

  function fail(category) {
    if (stopped) {
      return;
    }
    destroy();
    status("error", { error: category });
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
          // The worker validates the complete gzip stream and NBT.
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
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes.buffer;
    } catch (error) {
      if (!stopped) {
        fail(error instanceof PreviewError ? error.category : "download");
      }
    }
  }

  async function start() {
    let source;
    let worker;
    try {
      const base = new URL(window.location.href);
      source = checkedURL(url, base);
      worker = checkedURL(workerUrl, base);
      if (
        worker.origin !== base.origin ||
        typeof loadRenderer !== "function" ||
        !Number.isFinite(maxBytes) ||
        maxBytes <= 0 ||
        !Number.isFinite(timeoutMs) ||
        timeoutMs <= 0 ||
        !["light", "dark", "auto"].includes(theme) ||
        !container?.appendChild
      ) {
        throw new PreviewError("configuration");
      }
    } catch {
      fail("configuration");
      return;
    }
    timer = setTimeout(() => fail("timeout"), timeoutMs);
    status("loading", { progress: 0 });
    try {
      // Both begin only after a click. Code is browser-cacheable; parsed files aren't retained.
      const [buffer, renderer] = await Promise.all([
        download(source, Math.min(maxBytes, VIEWER_MAX_BYTES)),
        loadRenderer(),
      ]);
      if (stopped) {
        return;
      }
      phase = "viewer";
      status("loading");
      viewer = renderer.create({
        container,
        buffer,
        workerUrl: worker.href,
        theme,
        labels,
        onReady: () => {
          if (!stopped) {
            clearTimeout(timer);
            status("ready", { progress: 100 });
          }
        },
        onError: (category) =>
          fail(ERROR_CATEGORIES.has(category) ? category : "viewer"),
      });
      // A graphics failure may call onError synchronously during construction.
      if (stopped) {
        viewer?.destroy();
      }
    } catch {
      fail("viewer");
    }
  }

  start();
  return { destroy };
}
