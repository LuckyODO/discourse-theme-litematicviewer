/* eslint-disable qunit/require-expect -- These are Playwright tests, not QUnit tests. */
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { PNG } from "pngjs";
import { Matrix4, Vector3 } from "three";
import { createChestSidesFixture } from "../fixtures/chest-sides.mjs";

const sides = {
  north: [0, 0, -1],
  east: [1, 0, 0],
  south: [0, 0, 1],
  west: [-1, 0, 0],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const prototype = WebGL2RenderingContext.prototype;
    const getLocation = prototype.getUniformLocation;
    const setMatrix = prototype.uniformMatrix4fv;
    const names = new WeakMap();
    prototype.getUniformLocation = function (program, name) {
      const location = getLocation.call(this, program, name);
      if (location) {
        names.set(location, name);
      }
      return location;
    };
    // Change only the inspection camera, never worker geometry or materials.
    prototype.uniformMatrix4fv = function (
      location,
      transpose,
      matrix,
      ...rest
    ) {
      const name = names.get(location);
      if (name === "projectionMatrix") {
        window.chestProjection = Array.from(matrix);
      }
      if (name === "modelViewMatrix" && window.chestSideView) {
        window.chestDrawnView = window.chestViewId;
        return setMatrix.call(this, location, transpose, window.chestSideView);
      }
      return setMatrix.call(this, location, transpose, matrix, ...rest);
    };
  });
});

function sampleSurface(png, projection, view, size, side, [lowY, highY]) {
  const transform = new Matrix4().fromArray(projection).multiply(view);
  const axis = side === "east" || side === "west" ? 0 : 2;
  const transverse = axis === 0 ? 2 : 0;
  const dimensions = [size.x, size.y, size.z];
  const plane =
    side === "east" || side === "south" ? dimensions[axis] - 1 / 16 : 1 / 16;
  let covered = 0;
  let count = 0;
  for (let across = 0; across < 15; across++) {
    for (let vertical = 0; vertical < 7; vertical++) {
      const point = [0, lowY + ((highY - lowY) * vertical) / 6, 0];
      point[axis] = plane;
      point[transverse] = 0.15 + ((dimensions[transverse] - 0.3) * across) / 14;
      const projected = new Vector3(...point).applyMatrix4(transform);
      const x = Math.round(((projected.x + 1) * png.width) / 2);
      const y = Math.round(((1 - projected.y) * png.height) / 2);
      if (x < 0 || y < 0 || x >= png.width || y >= png.height) {
        continue;
      }
      const offset = (x + y * png.width) * 4;
      const [r, g, b] = png.data.subarray(offset, offset + 3);
      if (
        Math.max(Math.abs(r - 245), Math.abs(g - 246), Math.abs(b - 247)) > 25
      ) {
        covered++;
      }
      count++;
    }
  }
  return { coverage: covered / count, count };
}

for (const kind of ["single", "paired", "left", "right"]) {
  test(`${kind} chests have closed textured side walls in every facing`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60000);
    let fixture;
    await page.route("**/uploads/short-url/pavilion", (route) =>
      route.fulfill({
        contentType: "application/octet-stream",
        body: fixture.bytes,
      })
    );
    await mkdir(".impeccable/review/chest-sides", { recursive: true });
    for (const facing of Object.keys(sides)) {
      fixture = createChestSidesFixture(kind, facing);
      const { size } = fixture;
      await page.goto("/");
      await page.locator(".litematic-attachment__preview").click();
      await expect(page.locator("dialog")).toHaveAttribute(
        "data-state",
        "ready"
      );
      const center = new Vector3(size.x / 2, 7 / 16, size.z / 2);
      for (const [side, direction] of Object.entries(sides)) {
        const camera = center
          .clone()
          .addScaledVector(
            new Vector3(...direction),
            Math.max(3, size.x * 2, size.z * 2)
          );
        const view = new Matrix4()
          .lookAt(camera, center, new Vector3(0, 1, 0))
          .setPosition(camera)
          .invert();
        const viewId = `${facing}-${side}`;
        await page.evaluate(
          ({ matrix, id }) => {
            window.chestSideView = matrix;
            window.chestViewId = id;
          },
          { matrix: view.elements, id: viewId }
        );
        await page.getByRole("button", { name: "放大", exact: true }).click();
        await expect
          .poll(() => page.evaluate(() => window.chestDrawnView))
          .toBe(viewId);
        const pngBytes = await page
          .locator(".litematic-canvas canvas")
          .screenshot({ scale: "css" });
        const png = PNG.sync.read(pngBytes);
        const projection = await page.evaluate(() => window.chestProjection);
        const body = sampleSurface(png, projection, view, size, side, [
          1.5 / 16,
          8 / 16,
        ]);
        const lid = sampleSurface(png, projection, view, size, side, [
          10.5 / 16,
          13 / 16,
        ]);
        if (facing === "south" && (side === "east" || side === "south")) {
          await page.locator(".litematic-canvas canvas").screenshot({
            path: `.impeccable/review/chest-sides/${testInfo.project.name}-${kind}-${side}.png`,
            scale: "css",
          });
        }
        expect
          .soft(body.count, `${facing}/${side} body sample count`)
          .toBe(105);
        expect
          .soft(body.coverage, `${facing}/${side} body opacity`)
          .toBeGreaterThan(0.97);
        expect
          .soft(lid.coverage, `${facing}/${side} lid opacity`)
          .toBeGreaterThan(0.97);
      }
    }
  });
}
