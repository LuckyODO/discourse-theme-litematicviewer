/* eslint-disable qunit/require-expect -- These are Playwright tests, not QUnit tests. */
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { PNG } from "pngjs";
import { MODEL_SHOWCASE_EXPECTED } from "../fixtures/model-showcase.mjs";

const externalRequests = new WeakMap();
const scriptErrors = new WeakMap();
const attachmentPath = "**/uploads/short-url/pavilion";

test.beforeEach(async ({ page }) => {
  const requests = [];
  const errors = [];
  externalRequests.set(page, requests);
  scriptErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://localhost:4173") {
      return route.continue();
    }
    requests.push(url.href);
    return route.abort("blockedbyclient");
  });
});

test.afterEach(async ({ page }) => {
  expect(externalRequests.get(page)).toEqual([]);
  expect(scriptErrors.get(page)).toEqual([]);
});

async function openPreview(page) {
  await page.locator(".litematic-attachment__preview").click();
}

async function expectReady(page) {
  await expect(page.locator("dialog")).toHaveAttribute("data-state", "ready");
  await expect(page.locator(".litematic-model-summary")).toHaveAttribute(
    "data-block-count",
    "217"
  );
  await expect(page.locator(".litematic-model-summary")).toContainText(
    "9 × 7 × 9"
  );
  await expect(page.locator(".litematic-canvas canvas")).toBeVisible();
  await expect(page.locator(".litematic-preview__status")).not.toBeVisible();
}

async function countColoredPixels(page, png) {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let index = 0; index < data.length; index += 4) {
      const [red, green, blue] = data.subarray(index, index + 3);
      if (Math.max(red, green, blue) - Math.min(red, green, blue) > 40) {
        count++;
      }
    }
    return count;
  }, png.toString("base64"));
}

test("loads only on demand, renders actual geometry, and releases it on close", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/");
  const preview = page.getByRole("button", {
    name: "3D 预览: 林间小亭.litematic",
  });
  await expect(preview).toBeVisible();
  await expect(page.locator("canvas, iframe")).toHaveCount(0);
  expect(requests.filter((url) => /\/uploads\/|\/assets\//.test(url))).toEqual(
    []
  );
  await expect(page.locator(".litematic-attachment__download")).toHaveAttribute(
    "href",
    "/uploads/short-url/pavilion"
  );
  await expect(page.getByRole("link", { name: "说明.txt" })).toBeVisible();
  await preview.click();
  await expectReady(page);
  expect(
    requests.some((url) => url.endsWith("/assets/litematic-renderer.js"))
  ).toBe(true);
  expect(
    requests.some((url) => url.endsWith("/assets/litematic-worker.js"))
  ).toBe(true);
  const pixels = await page.locator(".litematic-canvas canvas").screenshot();
  expect(await countColoredPixels(page, pixels)).toBeGreaterThan(100);
  await page.getByRole("button", { name: "关闭预览" }).click();
  await expect(page.locator(".litematic-viewer, canvas, iframe")).toHaveCount(
    0
  );
  await expect(preview).toBeFocused();
  await preview.click();
  await expectReady(page);
  await expect(
    page.locator('script[src="/assets/litematic-renderer.js"]')
  ).toHaveCount(1);
  await page.getByRole("button", { name: "关闭预览" }).click();
  await expect(page.locator(".litematic-viewer, canvas")).toHaveCount(0);
});

test("supports layers, material counts, zoom, and reset", async ({ page }) => {
  await page.goto("/");
  await openPreview(page);
  await expectReady(page);
  const canvas = page.locator(".litematic-canvas canvas");
  const initial = await canvas.screenshot();
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect
    .poll(async () => (await canvas.screenshot()).equals(initial))
    .toBe(false);
  await page.getByRole("button", { name: "重置视角" }).click();
  await page.locator(".litematic-materials summary").click();
  await expect(page.locator(".litematic-materials__list li")).toHaveCount(5);
  await expect(
    page
      .locator(".litematic-materials__list li")
      .filter({ hasText: "grass_block" })
  ).toHaveText("grass_block81");
  await page.locator(".litematic-materials summary").click();
  const layer = page.getByRole("slider", { name: "分层" });
  await layer.focus();
  await layer.press("Home");
  await expect(layer).toHaveValue("0");
  await expect(page.locator(".litematic-layer-value")).toHaveText("Y ≤ 0");
  await expect(page.locator(".litematic-viewer")).not.toHaveAttribute(
    "aria-busy",
    "true"
  );
  const lowerLayer = await canvas.screenshot();
  expect(lowerLayer.equals(initial)).toBe(false);
  expect(await countColoredPixels(page, lowerLayer)).toBeGreaterThan(100);
  await layer.press("End");
  await expect(layer).toHaveValue("6");
  await expect(page.locator(".litematic-layer-value")).toHaveText("全部层");
  await expect(page.locator(".litematic-viewer")).not.toHaveAttribute(
    "aria-busy",
    "true"
  );
  await expectReady(page);
});

test("renders the bundled texture pixels on the actual mesh", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const decode = window.createImageBitmap.bind(window);
    window.createImageBitmap = async (...args) => {
      const bitmap = await decode(...args);
      if (!window.useWhiteAtlas) {
        return bitmap;
      }
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      bitmap.close();
      const context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      return decode(canvas);
    };
  });
  await page.goto("/");
  await openPreview(page);
  await expectReady(page);
  const textured = PNG.sync.read(
    await page.locator(".litematic-canvas canvas").screenshot()
  );
  await page.getByRole("button", { name: "关闭预览" }).click();
  await page.evaluate(() => (window.useWhiteAtlas = true));
  await openPreview(page);
  await expectReady(page);
  const untextured = PNG.sync.read(
    await page.locator(".litematic-canvas canvas").screenshot()
  );
  expect([untextured.width, untextured.height]).toEqual([
    textured.width,
    textured.height,
  ]);
  let changed = 0;
  for (let index = 0; index < textured.data.length; index += 4) {
    if (
      Math.abs(textured.data[index] - untextured.data[index]) +
        Math.abs(textured.data[index + 1] - untextured.data[index + 1]) +
        Math.abs(textured.data[index + 2] - untextured.data[index + 2]) >
      60
    ) {
      changed++;
    }
  }
  expect(changed).toBeGreaterThan(1000);
});

test("renders embedded textures with CSP denying all image URLs", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.cspViolations.push(event.violatedDirective);
    });
  });
  await page.route("http://localhost:4173/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self'; connect-src 'self'; img-src 'none'",
      },
    });
  });
  await page.goto("/");
  await openPreview(page);
  await expectReady(page);
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
});

test("renders vanilla model states and layered fluids with two batched surface passes", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.modelMeshes = [];
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.type === "mesh") {
            window.modelMeshes.push({
              faces: data.faceCount,
              opaque: data.opaqueFaceCount,
              translucent: data.translucentFaceCount,
              fallback: data.fallbackBlockCount,
            });
          }
        });
      }
    };
    window.surfaceFrames = [];
    const prototype = WebGL2RenderingContext.prototype;
    const clear = prototype.clear;
    const draw = prototype.drawElements;
    prototype.clear = function (...args) {
      window.surfaceFrames.push([]);
      return clear.apply(this, args);
    };
    prototype.drawElements = function (mode, count, ...args) {
      if (mode === this.TRIANGLES && count) {
        window.surfaceFrames.at(-1)?.push({
          count,
          blend: this.isEnabled(this.BLEND),
          depthWrite: this.getParameter(this.DEPTH_WRITEMASK),
        });
      }
      return draw.call(this, mode, count, ...args);
    };
  });
  await page.goto("/?showcase=1");
  await openPreview(page);
  await expect(page.locator("dialog")).toHaveAttribute("data-state", "ready");
  await expect(page.locator(".litematic-model-summary")).toHaveAttribute(
    "data-block-count",
    String(MODEL_SHOWCASE_EXPECTED.blockCount)
  );
  await expect(page.locator(".litematic-model-summary")).toContainText(
    MODEL_SHOWCASE_EXPECTED.dimensions.join(" × ")
  );
  await expect(page.locator(".litematic-model-note")).not.toContainText(
    "后备模型"
  );
  const stats = await page.evaluate(() => ({
    mesh: window.modelMeshes.at(-1),
    frame: window.surfaceFrames.filter((frame) => frame.length).at(-1),
  }));
  expect(stats.mesh.fallback).toBe(0);
  expect(stats.mesh.opaque).toBeGreaterThan(0);
  expect(stats.mesh.translucent).toBeGreaterThan(0);
  expect(stats.mesh.faces).toBe(stats.mesh.opaque + stats.mesh.translucent);
  expect(stats.frame).toEqual([
    { count: stats.mesh.opaque * 6, blend: false, depthWrite: true },
    { count: stats.mesh.translucent * 6, blend: true, depthWrite: false },
  ]);
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await mkdir(".impeccable/review", { recursive: true });
  await page.screenshot({
    path: `.impeccable/review/vanilla-models-${testInfo.project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  const canvas = page.locator(".litematic-canvas canvas");
  const initial = await canvas.screenshot();
  const canvasBounds = await canvas.boundingBox();
  const dragX = canvasBounds.x + canvasBounds.width * 0.5;
  const dragY = canvasBounds.y + canvasBounds.height * 0.5;
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(
    dragX + Math.min(150, canvasBounds.width * 0.3),
    dragY + 25,
    { steps: 12 }
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await canvas.screenshot()).equals(initial))
    .toBe(false);
  expect(await page.evaluate(() => window.modelMeshes.length)).toBe(1);
  const slider = page.getByRole("slider", { name: "分层" });
  await slider.focus();
  await slider.press("Home");
  await expect(page.locator(".litematic-viewer")).not.toHaveAttribute(
    "aria-busy",
    "true"
  );
  expect(await page.evaluate(() => window.modelMeshes.at(-1).translucent)).toBe(
    0
  );
  await slider.press("End");
  await expect(page.locator(".litematic-viewer")).not.toHaveAttribute(
    "aria-busy",
    "true"
  );
  expect(
    await page.evaluate(() => window.modelMeshes.at(-1).translucent)
  ).toBeGreaterThan(0);
});

test("glass and water visibly blend with the structure behind them", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const prototype = WebGL2RenderingContext.prototype;
    const enable = prototype.enable;
    const disable = prototype.disable;
    prototype.enable = function (capability) {
      if (capability === this.BLEND && window.disableBlending) {
        return disable.call(this, capability);
      }
      return enable.call(this, capability);
    };
  });
  await page.goto("/?showcase=1");
  await openPreview(page);
  await expect(page.locator("dialog")).toHaveAttribute("data-state", "ready");
  const blended = PNG.sync.read(
    await page.locator(".litematic-canvas canvas").screenshot()
  );
  await page.getByRole("button", { name: "关闭预览" }).click();
  await page.evaluate(() => (window.disableBlending = true));
  await openPreview(page);
  await expect(page.locator("dialog")).toHaveAttribute("data-state", "ready");
  const opaque = PNG.sync.read(
    await page.locator(".litematic-canvas canvas").screenshot()
  );
  let changed = 0;
  for (let index = 0; index < blended.data.length; index += 4) {
    if (
      Math.abs(blended.data[index] - opaque.data[index]) +
        Math.abs(blended.data[index + 1] - opaque.data[index + 1]) +
        Math.abs(blended.data[index + 2] - opaque.data[index + 2]) >
      40
    ) {
      changed++;
    }
  }
  expect(changed).toBeGreaterThan(1000);
});

test("releases an atlas decoded after closing and loads a fresh one on reopen", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const decode = window.createImageBitmap.bind(window);
    window.atlasTraffic = { created: 0, closed: 0 };
    window.createImageBitmap = async (...args) => {
      const bitmap = await decode(...args);
      window.atlasTraffic.created++;
      const close = bitmap.close.bind(bitmap);
      bitmap.close = () => {
        window.atlasTraffic.closed++;
        close();
      };
      if (window.atlasTraffic.created === 1) {
        await new Promise((resolve) => (window.releaseAtlas = resolve));
      }
      return bitmap;
    };
  });
  await page.goto("/");
  await openPreview(page);
  await expect
    .poll(() => page.evaluate(() => window.atlasTraffic.created))
    .toBe(1);
  await expect(page.locator("dialog")).toHaveAttribute("data-state", "loading");
  await page.getByRole("button", { name: "关闭预览" }).click();
  await page.evaluate(() => window.releaseAtlas());
  await expect
    .poll(() => page.evaluate(() => window.atlasTraffic.closed))
    .toBe(1);
  await expect(page.locator(".litematic-viewer, canvas")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.previewEvents.some((event) => event.state === "ready")
    )
  ).toBe(false);
  await openPreview(page);
  await expectReady(page);
  await page.getByRole("button", { name: "关闭预览" }).click();
  expect(await page.evaluate(() => window.atlasTraffic)).toEqual({
    created: 2,
    closed: 2,
  });
});

test("keeps download and retry available when bundled texture decoding fails", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const decode = window.createImageBitmap.bind(window);
    window.failAtlasDecode = true;
    window.createImageBitmap = (...args) => {
      if (window.failAtlasDecode) {
        return Promise.reject(new Error("Simulated image decode failure"));
      }
      return decode(...args);
    };
  });
  await page.goto("/");
  await openPreview(page);
  await expect(page.locator("dialog")).toHaveAttribute(
    "data-error",
    "configuration"
  );
  await expect(page.locator(".litematic-viewer, canvas")).toHaveCount(0);
  await expect(page.locator(".litematic-preview__download")).toBeVisible();
  await page.evaluate(() => (window.failAtlasDecode = false));
  await page.getByRole("button", { name: "重试" }).click();
  await expectReady(page);
});

test("coalesces layer changes while the real worker is busy", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const replayed = new WeakSet();
    const traffic = { active: 0, maximum: 0, sent: [], delivered: [] };
    window.layerTraffic = traffic;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", (event) => {
          if (
            event.data.id <= 0 ||
            !["mesh", "error"].includes(event.data.type) ||
            replayed.has(event)
          ) {
            return;
          }
          event.stopImmediatePropagation();
          // Delay delivery only: the unmodified worker still parses and meshes.
          setTimeout(() => {
            traffic.active--;
            traffic.delivered.push(event.data.id);
            const delivered = new MessageEvent("message", { data: event.data });
            replayed.add(delivered);
            this.dispatchEvent(delivered);
          }, 300);
        });
      }

      postMessage(message, transfer) {
        if (message.type === "layer") {
          traffic.active++;
          traffic.maximum = Math.max(traffic.maximum, traffic.active);
          traffic.sent.push({ id: message.id, y: message.y });
        }
        super.postMessage(message, transfer);
      }
    };
  });
  await page.goto("/");
  await openPreview(page);
  await expectReady(page);
  const canvas = page.locator(".litematic-canvas canvas");
  const completeModel = await canvas.screenshot();
  await page.locator(".litematic-layer").evaluate(async (layer) => {
    for (const y of [5, 4, 3, 2, 1, 0]) {
      layer.value = String(y);
      layer.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 160));
    }
  });
  await expect(page.locator(".litematic-viewer")).not.toHaveAttribute(
    "aria-busy",
    "true"
  );
  const traffic = await page.evaluate(() => window.layerTraffic);
  expect(traffic.maximum).toBe(1);
  expect(traffic.active).toBe(0);
  expect(traffic.sent.length).toBeLessThan(6);
  expect(traffic.sent.at(-1).y).toBe(0);
  expect(traffic.delivered.at(-1)).toBe(traffic.sent.at(-1).id);
  await expect(page.locator(".litematic-layer-value")).toHaveText("Y ≤ 0");
  const groundLayer = await canvas.screenshot();
  expect(groundLayer.equals(completeModel)).toBe(false);
  expect(await countColoredPixels(page, groundLayer)).toBeGreaterThan(100);
});

test("handles WebGL context loss with download still available", async ({
  page,
}) => {
  await page.goto("/");
  await openPreview(page);
  await expectReady(page);
  const supported = await page
    .locator(".litematic-canvas canvas")
    .evaluate((canvas) => {
      const extension = canvas
        .getContext("webgl2")
        .getExtension("WEBGL_lose_context");
      extension?.loseContext();
      return Boolean(extension);
    });
  expect(supported).toBe(true);
  await expect(page.locator("dialog")).toHaveAttribute(
    "data-error",
    "graphics"
  );
  await expect(page.locator(".litematic-viewer, canvas")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
  await expect(page.locator(".litematic-preview__download")).toHaveAttribute(
    "href",
    /uploads\/short-url\/pavilion/
  );
});

test("redecoration preserves attachment identity without duplicating controls", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".litematic-attachment")).toHaveCount(1);
  await page.evaluate(() => {
    window.redecorate();
    window.redecorate();
  });
  await expect(page.locator(".litematic-attachment__preview")).toHaveCount(1);
  await expect(page.locator("a.attachment")).toHaveCount(2);
  await openPreview(page);
  await expectReady(page);
});

for (const scenario of [
  { name: "invalid gzip header", body: Buffer.from("not a schematic") },
  { name: "invalid compressed NBT", body: gzipSync(Buffer.from("not NBT")) },
]) {
  test(`rejects ${scenario.name} and keeps the download`, async ({ page }) => {
    await page.route(attachmentPath, (route) =>
      route.fulfill({
        contentType: "application/octet-stream",
        body: scenario.body,
      })
    );
    await page.goto("/");
    await openPreview(page);
    await expect(page.locator("dialog")).toHaveAttribute(
      "data-error",
      "invalid"
    );
    await expect(page.locator(".litematic-viewer, canvas")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
    await expect(page.locator(".litematic-preview__download")).toHaveAttribute(
      "href",
      /uploads\/short-url\/pavilion/
    );
  });
}

for (const scenario of [
  { query: "small=1", error: "too_large" },
  { query: "slow=1&timeout=1", error: "timeout" },
]) {
  test(`cleans up ${scenario.error} failure and keeps the download`, async ({
    page,
  }) => {
    await page.goto(`/?${scenario.query}`);
    await openPreview(page);
    await expect(page.locator("dialog")).toHaveAttribute(
      "data-error",
      scenario.error
    );
    await expect(page.locator(".litematic-viewer, canvas")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
    await expect(page.locator(".litematic-preview__download")).toHaveAttribute(
      "href",
      /uploads\/short-url\/pavilion/
    );
  });
}

test("retries a denied attachment after access is restored", async ({
  page,
}) => {
  let attempts = 0;
  await page.route(attachmentPath, (route) => {
    attempts++;
    return attempts === 1
      ? route.fulfill({
          status: 403,
          contentType: "text/plain",
          body: "Forbidden",
        })
      : route.continue();
  });
  await page.goto("/");
  await openPreview(page);
  await expect(page.locator("dialog")).toHaveAttribute(
    "data-error",
    "download"
  );
  await expect(page.locator(".litematic-preview__download")).toBeVisible();
  await page.getByRole("button", { name: "重试" }).click();
  await expectReady(page);
  expect(attempts).toBe(2);
});

test("closing during download cancels the request and never mounts a viewer", async ({
  page,
}) => {
  await page.goto("/?slow=1");
  const started = page.waitForRequest((request) =>
    request.url().includes("/uploads/short-url/pavilion?slow=1")
  );
  await openPreview(page);
  await started;
  const cancelled = page.waitForEvent("requestfailed", {
    predicate: (request) =>
      request.url().includes("/uploads/short-url/pavilion"),
  });
  await page.getByRole("button", { name: "关闭预览" }).click();
  await cancelled;
  await expect(page.locator("dialog")).not.toBeVisible();
  await expect(page.locator(".litematic-viewer, canvas")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.previewEvents.some((event) => event.state === "ready")
    )
  ).toBe(false);
});

test("fits the viewport and closes with Escape from the canvas", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const viewport = page.viewportSize();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(viewport.width);
  await openPreview(page);
  await expectReady(page);
  const bounds = await page.locator("dialog").boundingBox();
  expect(bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.height).toBeLessThanOrEqual(viewport.height);
  await mkdir(".impeccable/review", { recursive: true });
  await page.screenshot({
    path: `.impeccable/review/bundled-${testInfo.project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.locator(".litematic-canvas canvas").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).not.toBeVisible();
  await expect(page.locator(".litematic-viewer, canvas")).toHaveCount(0);
});
