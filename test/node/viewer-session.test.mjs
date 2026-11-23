import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setImmediate, setTimeout } from "node:timers/promises";

const source = await readFile(
  new URL(
    "../../javascripts/discourse/lib/litematic-viewer-session.js",
    import.meta.url
  ),
  "utf8"
);
const { createViewerSession } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const GZIP_BYTES = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]);

function harness(t, response = () => new Response(GZIP_BYTES)) {
  const statuses = [],
    requests = [],
    viewers = [];
  let scriptLoads = 0;
  const globals = {
    window: { location: new URL("https://forum.example/t/build/123") },
    fetch: async (...args) => {
      requests.push(args);
      return response(...args);
    },
  };
  const originals = Object.fromEntries(
    Object.keys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ])
  );
  Object.assign(globalThis, globals);
  let session;
  const renderer = {
    create(options) {
      const viewer = {
        options,
        destroyed: false,
        destroy() {
          this.destroyed = true;
        },
      };
      viewers.push(viewer);
      return viewer;
    },
  };
  t.after(() => {
    session?.destroy();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete globalThis[key];
      }
    }
  });
  return {
    statuses,
    requests,
    viewers,
    renderer,
    scriptLoads: () => scriptLoads,
    start(options = {}) {
      session = createViewerSession({
        container: { appendChild() {} },
        url: "/uploads/build.litematic",
        workerUrl: "/theme-javascripts/worker.js",
        maxBytes: 1024,
        loadRenderer: async () => {
          scriptLoads++;
          return renderer;
        },
        onStatus: (value) => statuses.push(value),
        ...options,
      });
      return session;
    },
  };
}
async function settle() {
  await setImmediate();
  await setImmediate();
}

test("loads local renderer once on demand and sends exact bytes to a same-origin worker", async (t) => {
  const h = harness(t);
  assert.equal(h.scriptLoads(), 0);
  h.start();
  await settle();
  assert.equal(h.scriptLoads(), 1);
  assert.equal(h.viewers.length, 1);
  assert.equal(
    h.viewers[0].options.workerUrl,
    "https://forum.example/theme-javascripts/worker.js"
  );
  assert.deepEqual(new Uint8Array(h.viewers[0].options.buffer), GZIP_BYTES);
  assert.equal(h.requests[0][1].credentials, "same-origin");
  assert.equal(h.requests[0][1].referrerPolicy, "no-referrer");
  h.viewers[0].options.onReady();
  assert.deepEqual(h.statuses.at(-1), {
    state: "ready",
    phase: "viewer",
    progress: 100,
  });
});

test("cross-origin storage omits credentials; renderer waits for attachment", async (t) => {
  let finish;
  const h = harness(
    t,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  h.start({ url: "https://uploads.example/file" });
  await settle();
  assert.equal(h.viewers.length, 0);
  assert.equal(h.requests[0][1].credentials, "omit");
  finish(new Response(GZIP_BYTES));
  await settle();
  assert.equal(h.viewers.length, 1);
});

test("enforces streamed size even without or with a misleading Content-Length", async (t) => {
  for (const headers of [{}, { "Content-Length": "1" }]) {
    await t.test(JSON.stringify(headers), async (sub) => {
      let cancelled = false;
      const h = harness(
        sub,
        () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(GZIP_BYTES);
                controller.enqueue(new Uint8Array(10));
              },
              cancel() {
                cancelled = true;
              },
            }),
            { headers }
          )
      );
      h.start({ maxBytes: 8 });
      await settle();
      assert.equal(h.statuses.at(-1).error, "too_large");
      assert.equal(cancelled, true);
      assert.equal(h.requests[0][1].signal.aborted, true);
      assert.equal(h.viewers.length, 0);
    });
  }
});

test("accepts gzip signature split across streamed chunks", async (t) => {
  const h = harness(
    t,
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of GZIP_BYTES) {
              controller.enqueue(new Uint8Array([byte]));
            }
            controller.close();
          },
        })
      )
  );
  h.start();
  await settle();
  assert.deepEqual(new Uint8Array(h.viewers[0].options.buffer), GZIP_BYTES);
});

for (const [label, response, expected] of [
  [
    "HTML login",
    () =>
      new Response("<html>secret</html>", {
        headers: { "Content-Type": "text/html" },
      }),
    "download",
  ],
  ["HTTP 403", () => new Response("Forbidden", { status: 403 }), "download"],
  ["empty", () => new Response(new Uint8Array()), "empty"],
  [
    "declared oversized",
    () => new Response(GZIP_BYTES, { headers: { "Content-Length": "2048" } }),
    "too_large",
  ],
  [
    "network error",
    () => {
      throw new Error("private details");
    },
    "download",
  ],
  [
    "HTML disguised as binary",
    () => new Response("<html>login</html>"),
    "invalid",
  ],
  [
    "truncated signature",
    () => new Response(new Uint8Array([0x1f, 0x8b])),
    "invalid",
  ],
  [
    "wrong compression method",
    () => new Response(new Uint8Array([0x1f, 0x8b, 0])),
    "invalid",
  ],
]) {
  test(`rejects ${label} without passing it to renderer`, async (t) => {
    const h = harness(t, response);
    h.start();
    await settle();
    assert.deepEqual(h.statuses.at(-1), {
      state: "error",
      phase: "download",
      error: expected,
    });
    assert.equal(h.viewers.length, 0);
    assert.equal(h.requests[0][1].signal.aborted, true);
  });
}

test("throttles streamed progress to integer percent changes", async (t) => {
  const bytes = new Uint8Array(1000);
  bytes.set(GZIP_BYTES);
  const h = harness(
    t,
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (let i = 0; i < bytes.length; i++) {
              controller.enqueue(bytes.subarray(i, i + 1));
            }
            controller.close();
          },
        }),
        { headers: { "Content-Length": "1000" } }
      )
  );
  h.start();
  await settle();
  const progress = h.statuses
    .filter((s) => s.phase === "download")
    .map((s) => s.progress);
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 100);
  assert.ok(progress.length <= 101);
  assert.equal(new Set(progress).size, progress.length);
});

test("close during download aborts and prevents late render construction", async (t) => {
  let finish;
  const h = harness(
    t,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const session = h.start();
  session.destroy();
  session.destroy();
  const count = h.statuses.length;
  finish(new Response(GZIP_BYTES));
  await settle();
  assert.equal(h.viewers.length, 0);
  assert.equal(h.statuses.length, count);
  assert.equal(h.requests[0][1].signal.aborted, true);
});

test("close during script loading prevents a late renderer", async (t) => {
  let finish;
  const h = harness(t);
  const session = h.start({
    loadRenderer: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  await settle();
  session.destroy();
  finish(h.renderer);
  await settle();
  assert.equal(h.viewers.length, 0);
});

test("timeout aborts outstanding download", async (t) => {
  const h = harness(t, () => new Promise(() => {}));
  h.start({ timeoutMs: 10 });
  await setTimeout(30);
  assert.equal(h.statuses.at(-1).error, "timeout");
  assert.equal(h.requests[0][1].signal.aborted, true);
});

test("successful first render cancels timeout; closing disposes the renderer", async (t) => {
  const h = harness(t);
  const session = h.start({ timeoutMs: 30 });
  await settle();
  h.viewers[0].options.onReady();
  await setTimeout(45);
  assert.equal(h.statuses.at(-1).state, "ready");
  session.destroy();
  assert.equal(h.viewers[0].destroyed, true);
});

test("renderer failure maps unknown messages to a safe category and disposes", async (t) => {
  const h = harness(t);
  h.start();
  await settle();
  h.viewers[0].options.onError("private error details");
  assert.equal(h.statuses.at(-1).error, "viewer");
  assert.equal(h.viewers[0].destroyed, true);
});

test("synchronous graphics failure still disposes newly returned renderer", async (t) => {
  const h = harness(t);
  let destroyed = false;
  h.start({
    loadRenderer: async () => ({
      create({ onError }) {
        onError("graphics");
        return {
          destroy() {
            destroyed = true;
          },
        };
      },
    }),
  });
  await settle();
  assert.equal(h.statuses.at(-1).error, "graphics");
  assert.equal(destroyed, true);
});

test("script load failure aborts the download", async (t) => {
  const h = harness(t, () => new Promise(() => {}));
  h.start({
    loadRenderer: async () => {
      throw new Error("failed script");
    },
  });
  await settle();
  assert.equal(h.statuses.at(-1).error, "viewer");
  assert.equal(h.requests[0][1].signal.aborted, true);
});

for (const [label, options] of [
  // eslint-disable-next-line no-script-url -- Verify rejection before any execution.
  ["executable attachment", { url: "javascript:alert(1)" }],
  ["attachment credentials", { url: "https://user:pass@forum.example/file" }],
  ["mixed-content attachment", { url: "http://uploads.example/file" }],
  ["external worker", { workerUrl: "https://public-viewer.example/worker.js" }],
  ["missing worker", { workerUrl: "" }],
  ["missing attachment", { url: "" }],
  ["invalid size limit", { maxBytes: -1 }],
  ["invalid timeout", { timeoutMs: NaN }],
]) {
  test(`rejects ${label} before loading assets or attachments`, (t) => {
    const h = harness(t);
    h.start(options);
    assert.equal(h.statuses.at(-1).error, "configuration");
    assert.equal(h.requests.length, 0);
    assert.equal(h.scriptLoads(), 0);
  });
}
