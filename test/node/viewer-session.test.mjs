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
const PROTOCOL = "litematic-preview-v1";
const GZIP_BYTES = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]);

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type, event = {}) {
      for (const listener of listeners.get(type) || []) {
        listener(event);
      }
    },
    count(type) {
      return listeners.get(type)?.size || 0;
    },
  };
}

function harness(t, fetchResponse = () => new Response(GZIP_BYTES)) {
  const statuses = [];
  const requests = [];
  const messages = [];
  const frames = [];
  let closeCalls = 0;
  const window = {
    ...eventTarget(),
    location: new URL("https://forum.example/t/build/123"),
  };
  const document = {
    ...eventTarget(),
    hidden: false,
    createElement(tag) {
      assert.equal(tag, "iframe");
      return {
        attributes: {},
        setAttribute(key, value) {
          this.attributes[key] = value;
        },
        contentWindow: {
          postMessage(payload, origin) {
            messages.push({ payload, origin });
          },
        },
        remove() {
          this.removed = true;
        },
      };
    },
  };
  const globals = {
    window,
    document,
    fetch: async (...args) => {
      requests.push(args);
      return fetchResponse(...args);
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
  const start = (options = {}) => {
    session = createViewerSession({
      container: { appendChild: (frame) => frames.push(frame) },
      url: "/uploads/example.litematic",
      name: "My build.litematic",
      viewerUrl: "https://viewer.example/",
      maxBytes: 1024,
      onStatus: (value) => statuses.push(value),
      onClose: () => closeCalls++,
      ...options,
    });
    return session;
  };
  function receive(type, details = {}, overrides = {}) {
    const frame = frames[0];
    const viewer = new URL(frame.src);
    window.emit("message", {
      source: frame.contentWindow,
      origin: viewer.origin,
      data: {
        protocol: PROTOCOL,
        channel: viewer.searchParams.get("channel"),
        type,
        ...details,
      },
      ...overrides,
    });
  }
  return {
    start,
    receive,
    window,
    document,
    statuses,
    requests,
    messages,
    frames,
    closeCalls: () => closeCalls,
  };
}

async function settle() {
  await setImmediate();
  await setImmediate();
}

test("waits for a trusted handshake, then sends one named file with safe options", async (t) => {
  const h = harness(t);
  h.start();
  await settle();
  assert.equal(h.messages.length, 0);
  const iframe = h.frames[0];
  const viewer = new URL(iframe.src);
  assert.equal(viewer.pathname, "/index.html");
  assert.equal(viewer.searchParams.get("embedded"), "1");
  assert.equal(
    viewer.searchParams.get("parentOrigin"),
    "https://forum.example"
  );
  assert.equal(viewer.searchParams.has("file"), false);
  assert.equal(iframe.referrerPolicy, "no-referrer");
  assert.equal(
    iframe.attributes.sandbox,
    "allow-scripts allow-same-origin allow-downloads"
  );
  assert.equal(h.requests[0][1].credentials, "same-origin");
  assert.equal(h.requests[0][1].referrerPolicy, "no-referrer");

  h.receive("ready", {}, { origin: "https://attacker.example" });
  h.receive("ready", {}, { source: {} });
  h.receive("ready", { protocol: "another-protocol" });
  h.receive("ready", { channel: "another-channel" });
  assert.equal(h.messages.length, 0);

  h.receive("ready");
  h.receive("ready");
  const sent = h.messages.filter(({ payload }) => payload.type === "load");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].origin, "https://viewer.example");
  assert.equal(sent[0].payload.file.name, "My build.litematic");
  assert.deepEqual(
    [...new Uint8Array(await sent[0].payload.file.arrayBuffer())],
    [...GZIP_BYTES]
  );
  const configure = h.messages.find(
    ({ payload }) => payload.type === "configure"
  );
  assert.equal(configure.payload.options.viewer.panels.file, false);
  assert.equal(configure.payload.options.viewer.tools.help, false);

  h.receive("loading", { progress: 0.25, message: "untrusted remote text" });
  assert.deepEqual(h.statuses.at(-1), {
    state: "loading",
    phase: "viewer",
    progress: 25,
  });
  h.receive("loaded");
  assert.deepEqual(h.statuses.at(-1), {
    state: "ready",
    phase: "viewer",
    progress: 100,
  });
});

test("a ready iframe waits for the download; external downloads omit credentials", async (t) => {
  let finish;
  const h = harness(
    t,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  h.start({ url: "https://uploads.example/example.litematic" });
  h.receive("ready");
  assert.equal(h.messages.length, 0);
  assert.equal(h.requests[0][1].credentials, "omit");
  finish(new Response(GZIP_BYTES));
  await settle();
  assert.equal(
    h.messages.filter(({ payload }) => payload.type === "load").length,
    1
  );
});

test("streamed size enforcement stops a response with no Content-Length", async (t) => {
  let cancelled = false;
  const h = harness(
    t,
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([...GZIP_BYTES, 0]));
            controller.enqueue(new Uint8Array(5));
          },
          cancel() {
            cancelled = true;
          },
        })
      )
  );
  h.start({ maxBytes: 8 });
  h.receive("ready");
  await settle();
  assert.equal(h.statuses.at(-1).error, "too_large");
  assert.equal(cancelled, true);
  assert.equal(h.frames[0].removed, true);
  assert.equal(h.requests[0][1].signal.aborted, true);
  assert.equal(h.messages.length, 0);
});

test("streamed size enforcement does not trust a smaller Content-Length", async (t) => {
  const h = harness(
    t,
    () =>
      new Response(new Uint8Array(10), {
        headers: { "Content-Length": "1" },
      })
  );
  h.start({ maxBytes: 8 });
  await settle();
  assert.equal(h.statuses.at(-1).error, "too_large");
});

test("accepts a gzip signature split across chunks without altering the file", async (t) => {
  const h = harness(
    t,
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array());
            controller.enqueue(GZIP_BYTES.subarray(0, 1));
            controller.enqueue(GZIP_BYTES.subarray(1, 2));
            controller.enqueue(GZIP_BYTES.subarray(2));
            controller.close();
          },
        })
      )
  );
  h.start();
  h.receive("ready");
  await settle();
  const load = h.messages.find(({ payload }) => payload.type === "load");
  assert.ok(load);
  assert.deepEqual(
    new Uint8Array(await load.payload.file.arrayBuffer()),
    GZIP_BYTES
  );
});

for (const [label, data] of [
  ["HTML with an octet-stream content type", "<html>private page</html>"],
  ["JSON with an octet-stream content type", '{"private":"data"}'],
  ["an incomplete gzip signature", new Uint8Array([0x1f, 0x8b])],
  ["an invalid gzip compression method", new Uint8Array([0x1f, 0x8b, 0x00])],
]) {
  test(`rejects ${label} before sending bytes to the viewer`, async (t) => {
    const h = harness(
      t,
      () =>
        new Response(data, {
          headers: { "Content-Type": "application/octet-stream" },
        })
    );
    h.start();
    h.receive("ready");
    await settle();
    assert.deepEqual(h.statuses.at(-1), {
      state: "error",
      phase: "download",
      error: "invalid",
    });
    assert.equal(h.messages.length, 0);
    assert.equal(h.frames[0].removed, true);
    assert.equal(h.requests[0][1].signal.aborted, true);
  });
}

test("download progress reports integer percent changes instead of every chunk", async (t) => {
  const bytes = new Uint8Array(1000);
  bytes.set(GZIP_BYTES);
  const h = harness(
    t,
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (let index = 0; index < bytes.length; index++) {
              controller.enqueue(bytes.subarray(index, index + 1));
            }
            controller.close();
          },
        }),
        { headers: { "Content-Length": String(bytes.length) } }
      )
  );
  h.start();
  await settle();
  const progress = h.statuses
    .filter((status) => status.phase === "download")
    .map((status) => status.progress);
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 100);
  assert.ok(progress.length <= 101);
  assert.equal(new Set(progress).size, progress.length);
  assert.ok(progress.every(Number.isInteger));
});

for (const [label, response, expected] of [
  [
    "HTML login response",
    () =>
      new Response("<html>Sign in</html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    "download",
  ],
  [
    "HTTP failure",
    () => new Response("Forbidden", { status: 403 }),
    "download",
  ],
  ["empty response", () => new Response(new Uint8Array()), "empty"],
  [
    "declared oversized response",
    () =>
      new Response(new Uint8Array([1]), {
        headers: { "Content-Length": "2048" },
      }),
    "too_large",
  ],
  [
    "network failure",
    () => {
      throw new Error("private internal error");
    },
    "download",
  ],
]) {
  test(`handles ${label} without exposing response details`, async (t) => {
    const h = harness(t, response);
    h.start();
    await settle();
    assert.deepEqual(h.statuses.at(-1), {
      state: "error",
      phase: "download",
      error: expected,
    });
    assert.equal(h.frames[0].removed, true);
    assert.equal(h.window.count("message"), 0);
    assert.equal(h.document.count("visibilitychange"), 0);
  });
}

test("maps viewer errors to a safe category and stops the session", async (t) => {
  const h = harness(t);
  h.start();
  h.receive("error", { message: "<script>untrusted</script>", code: "secret" });
  await settle();
  assert.deepEqual(h.statuses.at(-1), {
    state: "error",
    phase: "viewer",
    error: "viewer",
  });
  assert.equal(h.frames[0].removed, true);
});

test("overall timeout aborts the download and removes the frame", async (t) => {
  const h = harness(t, () => new Promise(() => {}));
  h.start({ timeoutMs: 10 });
  await setTimeout(30);
  assert.equal(h.statuses.at(-1).error, "timeout");
  assert.equal(h.requests[0][1].signal.aborted, true);
  assert.equal(h.frames[0].removed, true);
});

test("successful render cancels the timeout and follows page visibility", async (t) => {
  const h = harness(t);
  h.start({ timeoutMs: 30 });
  await settle();
  h.receive("ready");
  h.receive("loaded");
  h.document.hidden = true;
  h.document.emit("visibilitychange");
  assert.equal(h.messages.at(-1).payload.type, "active");
  assert.equal(h.messages.at(-1).payload.active, false);
  h.document.hidden = false;
  h.document.emit("visibilitychange");
  assert.equal(h.messages.at(-1).payload.active, true);
  await setTimeout(45);
  assert.equal(h.statuses.at(-1).state, "ready");
});

test("destroy prevents later download completion or iframe messages from updating UI", async (t) => {
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
  finish(new Response(new Uint8Array([1])));
  h.receive("ready");
  await settle();
  assert.equal(h.statuses.length, count);
  assert.equal(h.messages.length, 0);
  assert.equal(h.frames[0].removed, true);
  assert.equal(h.window.count("message"), 0);
  assert.equal(h.document.count("visibilitychange"), 0);
});

test("a trusted close request disposes the session and calls onClose once", async (t) => {
  const h = harness(t);
  h.start();
  h.receive("close-request");
  h.receive("close-request");
  await settle();
  assert.equal(h.closeCalls(), 1);
  assert.equal(h.frames[0].removed, true);
});

for (const [label, options] of [
  // eslint-disable-next-line no-script-url -- Verify rejection of executable attachment URLs.
  ["non-HTTP attachment", { url: "javascript:alert(1)" }],
  ["attachment credentials", { url: "https://user:pass@forum.example/file" }],
  ["mixed-content attachment", { url: "http://uploads.example/file" }],
  ["mixed-content viewer", { viewerUrl: "http://viewer.example/" }],
  ["viewer credentials", { viewerUrl: "https://user:pass@viewer.example/" }],
  ["empty viewer", { viewerUrl: "" }],
  ["empty attachment", { url: "" }],
  ["invalid byte limit", { maxBytes: -1 }],
]) {
  test(`rejects ${label} before creating a frame or downloading`, (t) => {
    const h = harness(t);
    h.start(options);
    assert.equal(h.statuses.at(-1).error, "configuration");
    assert.equal(h.frames.length, 0);
    assert.equal(h.requests.length, 0);
  });
}

test("allows an HTTP localhost viewer only from an HTTP development page", async (t) => {
  const h = harness(t);
  h.window.location = new URL("http://localhost:4200/t/example");
  h.start({ viewerUrl: "http://127.0.0.1:5000/" });
  await settle();
  assert.equal(h.frames.length, 1);
  h.receive("ready");
  assert.equal(
    h.messages.filter(({ payload }) => payload.type === "load").length,
    1
  );
});
