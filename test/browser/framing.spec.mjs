/* eslint-disable qunit/require-expect -- These are Playwright tests, not QUnit tests. */
import { expect, test } from "@playwright/test";
import { encodeLitematicFixture } from "../fixtures/litematic-fixture.mjs";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.type === "mesh") {
            window.framingVertices = Array.from(data.positions);
          }
        });
      }
    };
    // Observe the actual draw's camera uniforms and real worker vertices.
    // Rendering and model generation continue unchanged.
    const record = (gl, count) => {
      if (count !== window.framingVertices?.length / 3) {
        return;
      }
      const program = gl.getParameter(gl.CURRENT_PROGRAM);
      const projection = gl.getUniformLocation(program, "projectionMatrix");
      const modelView = gl.getUniformLocation(program, "modelViewMatrix");
      if (projection && modelView) {
        window.framingCamera = {
          projection: Array.from(gl.getUniform(program, projection)),
          modelView: Array.from(gl.getUniform(program, modelView)),
        };
      }
    };
    const prototype = WebGL2RenderingContext.prototype;
    const drawArrays = prototype.drawArrays;
    prototype.drawArrays = function (...args) {
      drawArrays.apply(this, args);
      record(this, args[2]);
    };
    const drawElements = prototype.drawElements;
    prototype.drawElements = function (...args) {
      drawElements.apply(this, args);
      record(this, args[1]);
    };
  });
});

for (const [name, size, palette, blocks] of [
  [
    "a wall banner extending below its source voxel",
    { x: 1, y: 1, z: 1 },
    [{ name: "red_wall_banner", properties: { facing: "north" } }],
    [1],
  ],
  [
    "a standing banner extending above the highest layer",
    { x: 1, y: 2, z: 1 },
    ["stone", { name: "white_banner", properties: { rotation: "0" } }],
    [1, 2],
  ],
]) {
  test(`fits ${name} and preserves the full framing on reset`, async ({
    page,
  }) => {
    const bytes = encodeLitematicFixture({
      name,
      regionName: "Framing",
      size,
      palette: ["air", ...palette],
      blocks,
    });
    await page.route("**/uploads/short-url/pavilion", (route) =>
      route.fulfill({ contentType: "application/octet-stream", body: bytes })
    );
    await page.goto("/");
    await page.locator(".litematic-attachment__preview").click();
    await expect(page.locator("dialog")).toHaveAttribute("data-state", "ready");
    const fit = await page.evaluate(() => {
      const { projection, modelView } = window.framingCamera;
      const transform = (matrix, vector) =>
        Array.from({ length: 4 }, (_, row) =>
          vector.reduce(
            (sum, value, column) => sum + matrix[row + column * 4] * value,
            0
          )
        );
      let maxX = 0;
      let maxY = 0;
      let minW = Infinity;
      let minModelY = Infinity;
      let maxModelY = -Infinity;
      for (let index = 0; index < window.framingVertices.length; index += 3) {
        const point = [...window.framingVertices.slice(index, index + 3), 1];
        minModelY = Math.min(minModelY, point[1]);
        maxModelY = Math.max(maxModelY, point[1]);
        const clip = transform(projection, transform(modelView, point));
        maxX = Math.max(maxX, Math.abs(clip[0] / clip[3]));
        maxY = Math.max(maxY, Math.abs(clip[1] / clip[3]));
        minW = Math.min(minW, clip[3]);
      }
      return { maxX, maxY, minW, modelView, minModelY, maxModelY };
    });
    expect(fit.minW).toBeGreaterThan(0);
    expect(fit.maxX).toBeLessThan(0.95);
    expect(fit.maxY).toBeLessThan(0.95);
    expect(fit.minModelY < 0 || fit.maxModelY > size.y).toBe(true);
    await expect(page.locator(".litematic-model-summary")).toContainText(
      `1 × ${size.y} × 1`
    );

    const initial = fit.modelView;
    if (size.y > 1) {
      const layer = page.getByRole("slider", { name: "分层" });
      await layer.focus();
      await layer.press("Home");
      await expect(page.locator(".litematic-viewer")).not.toHaveAttribute(
        "aria-busy",
        "true"
      );
      expect(await page.evaluate(() => window.framingCamera.modelView)).toEqual(
        initial
      );
    }
    await page.getByRole("button", { name: "放大", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.framingCamera.modelView))
      .not.toEqual(initial);
    await page.getByRole("button", { name: "重置视角" }).click();
    await expect
      .poll(() => page.evaluate(() => window.framingCamera.modelView))
      .toEqual(initial);
  });
}
