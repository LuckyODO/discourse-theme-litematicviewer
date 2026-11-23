/* eslint-disable qunit/require-expect -- These are Playwright tests, not QUnit tests. */
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("does not fetch files or viewers until clicked, and preserves downloads", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/");
  const preview = page.getByRole("button", {
    name: "3D 预览: 林间小亭.litematic",
  });
  await expect(preview).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(requests.filter((url) => /uploads\/|mock-viewer/.test(url))).toEqual(
    []
  );
  await expect(page.locator(".litematic-attachment__download")).toHaveAttribute(
    "href",
    "/uploads/short-url/pavilion"
  );
  await expect(page.getByRole("link", { name: "说明.txt" })).toBeVisible();
  await preview.click();
  await expect(page.locator("dialog")).toHaveAttribute("data-state", "ready");
  await expect(page.frameLocator("iframe").locator("body")).toHaveAttribute(
    "data-loads",
    "1"
  );
  await expect(page.frameLocator("iframe").locator("#result")).toContainText(
    "林间小亭.litematic"
  );
  await page.getByRole("button", { name: "关闭预览" }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
  await preview.click();
  await expect(page.locator("dialog")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("iframe")).toHaveCount(1);
});

test("redecoration does not duplicate controls or lose attachment identity", async ({
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
  await page.locator(".litematic-attachment__preview").click();
  await expect(page.locator("dialog")).toHaveAttribute("data-state", "ready");
});

for (const scenario of [
  { query: "mode=error", error: "viewer" },
  { query: "mode=silent&timeout=1", error: "timeout" },
  { query: "small=1", error: "too_large" },
]) {
  test(`cleans up ${scenario.error} failure and keeps download available`, async ({
    page,
  }) => {
    await page.goto(`/?${scenario.query}`);
    await page.locator(".litematic-attachment__preview").click();
    await expect(page.locator("dialog")).toHaveAttribute(
      "data-error",
      scenario.error
    );
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
    await expect(page.locator(".litematic-preview__download")).toHaveAttribute(
      "href",
      /uploads\/short-url\/pavilion/
    );
  });
}

test("fits narrow viewports and responds to Escape from inside the iframe", async ({
  page,
}) => {
  await page.goto("/");
  const viewport = page.viewportSize();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(viewport.width);
  await page.locator(".litematic-attachment__preview").click();
  await expect(page.locator("dialog")).toHaveAttribute("data-state", "ready");
  const bounds = await page.locator("dialog").boundingBox();
  expect(bounds.width).toBeLessThanOrEqual(viewport.width);
  await page.frameLocator("iframe").locator("body").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).not.toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("live viewer renders the original generated Litematic fixture", async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.LIVE_VIEWER,
    "Opt in to external-service verification with LIVE_VIEWER=1"
  );
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?live=1");
  await page.locator(".litematic-attachment__preview").click();
  await expect(page.locator("dialog")).toHaveAttribute("data-state", "ready", {
    timeout: 110000,
  });
  await expect(
    page.frameLocator("iframe").locator("canvas").first()
  ).toBeVisible();
  await mkdir(".impeccable/review", { recursive: true });
  await page.screenshot({
    path: `.impeccable/review/${testInfo.project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "关闭预览" }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
});
