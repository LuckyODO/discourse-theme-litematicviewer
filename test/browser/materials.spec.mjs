/* eslint-disable qunit/require-expect -- These are Playwright tests, not QUnit tests. */
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { encodeLitematicFixture } from "../fixtures/litematic-fixture.mjs";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === "http://localhost:4173"
      ? route.continue()
      : route.abort("blockedbyclient")
  );
});

async function openMaterials(page) {
  await page.goto("/");
  // This real bundled Discourse rule used to constrain the absolute list to
  // the tiny summary's box, leaving all rows outside its padded scroll area.
  // Source: plugins/discourse-details/assets/stylesheets/details.scss.
  await page.addStyleTag({ content: "details { position: relative; }" });
  await page.locator(".litematic-attachment__preview").click();
  await expect(page.locator("dialog")).toHaveAttribute("data-state", "ready");
  const toggle = page.locator(".litematic-materials__toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".litematic-materials__panel")).toBeHidden();
  await toggle.focus();
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  return toggle;
}

test("materials remain readable with Discourse details styles and keyboard controls", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const toggle = await openMaterials(page);
  await expect(toggle).toHaveText("材料 (5)");
  const panel = page.getByRole("region", { name: "材料 (5)" });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute(
    "id",
    await toggle.getAttribute("aria-controls")
  );
  await expect(panel.locator(".litematic-materials__scope")).toHaveText(
    "完整投影"
  );
  const list = panel.getByRole("list", { name: "材料" });
  await expect(list.locator("li")).toHaveCount(5);
  await expect(
    list.locator("li").filter({ hasText: "grass_block" })
  ).toHaveText("grass_block81");
  await expect(
    list.locator("li").filter({ hasText: "grass_block" })
  ).toBeInViewport();
  const bounds = await list.boundingBox();
  expect(bounds.width).toBeGreaterThan(200);
  expect(bounds.height).toBeGreaterThan(80);
  const dialogBounds = await page.locator("dialog").boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(dialogBounds.x);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(
    dialogBounds.x + dialogBounds.width
  );
  await mkdir(".impeccable/review", { recursive: true });
  await page.locator("dialog").screenshot({
    path: `.impeccable/review/materials-${testInfo.project.name}.png`,
  });

  await list.focus();
  await list.press("Escape");
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(page.locator("dialog")).toBeVisible();
  await toggle.press("Space");
  await expect(panel).toBeVisible();
  const canvas = page.locator(".litematic-canvas canvas");
  const canvasBounds = await canvas.boundingBox();
  await canvas.click({ position: { x: 20, y: canvasBounds.height - 20 } });
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "关闭预览" }).click();
  await expect(page.locator(".litematic-materials__panel")).toHaveCount(0);
  await page.locator(".litematic-attachment__preview").click();
  await expect(page.locator("dialog")).toHaveAttribute("data-state", "ready");
  await expect(page.locator(".litematic-materials__toggle")).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  await expect(page.locator(".litematic-materials__list li")).toHaveCount(5);
  expect(errors).toEqual([]);
});

test("long material IDs wrap and capped lists remain keyboard scrollable", async ({
  page,
}) => {
  const names = Array.from(
    { length: 205 },
    (_, index) =>
      `examplemod:very_long_material_identifier_${String(index).padStart(3, "0")}_with_additional_variant_information`
  );
  const bytes = encodeLitematicFixture({
    name: "Many material types",
    regionName: "Materials",
    size: { x: 205, y: 1, z: 1 },
    palette: ["air", ...names],
    blocks: names.map((_, index) => index + 1),
  });
  await page.route("**/uploads/short-url/pavilion", (route) =>
    route.fulfill({ contentType: "application/octet-stream", body: bytes })
  );
  const toggle = await openMaterials(page);
  await expect(toggle).toHaveText("材料 (205)");
  const list = page.getByRole("list", { name: "材料" });
  await expect(list.locator("li")).toHaveCount(201);
  const dimensions = await list.evaluate((node) => ({
    width: node.clientWidth,
    contentWidth: node.scrollWidth,
    height: node.clientHeight,
    contentHeight: node.scrollHeight,
  }));
  expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.width + 1);
  expect(dimensions.contentHeight).toBeGreaterThan(dimensions.height);
  expect(dimensions.height).toBeGreaterThan(80);
  await list.focus();
  await list.press("End");
  await expect(list.locator("li").last()).toHaveText("+5 种其他方块");
  await expect(list.locator("li").last()).toBeInViewport();
});
