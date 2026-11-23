/* eslint-disable qunit/require-expect -- These are Playwright tests, not QUnit tests. */
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";

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
