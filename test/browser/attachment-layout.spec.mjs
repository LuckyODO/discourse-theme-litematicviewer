/* eslint-disable qunit/require-expect -- These are Playwright tests, not QUnit tests. */
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

async function decorate(
  page,
  { width = 960, nested = false, fontSize = 16, english = false } = {}
) {
  await page.setViewportSize({ width, height: 1200 });
  await page.goto("/test/browser/attachment-layout.html");
  await page.evaluate(
    async (options) => {
      const { decorateAttachments, attachmentURL } =
        await import("/javascripts/discourse/lib/litematic-attachments.js");
      document.documentElement.style.fontSize = `${options.fontSize}px`;
      if (options.nested) {
        document.querySelector(".nested").style.width = "420px";
      }
      const cooked = document.querySelector(".cooked");
      window.originalCooked = cooked.innerHTML;
      window.originalAttachments = [
        ...cooked.querySelectorAll("#attachments a.attachment"),
      ];
      window.layoutPreviewEvents = [];
      window.restoreLayout = decorateAttachments(cooked, {
        labels: options.english
          ? { preview: "Preview 3D model", download: "Download file" }
          : { preview: "3D 预览", download: "下载" },
        onPreview(item) {
          window.layoutPreviewEvents.push({
            name: item.name,
            url: attachmentURL(item.anchor),
            original: window.originalAttachments.includes(item.anchor),
          });
        },
      });
    },
    { nested, fontSize, english }
  );
}

async function layout(page) {
  return page.locator("#attachments").evaluate((container) => {
    const rect = (node) => {
      const value = node.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    const rows = [...container.querySelectorAll(".litematic-attachment")].map(
      (row) => {
        const name = row.querySelector(".litematic-attachment__name");
        const preview = row.querySelector(".litematic-attachment__preview");
        const download = row.querySelector(".litematic-attachment__download");
        const style = getComputedStyle(name);
        return {
          row: rect(row),
          name: rect(name),
          preview: rect(preview),
          download: rect(download),
          text: row.textContent,
          title: name.title,
          nameText: name.textContent,
          ellipsis: style.textOverflow,
          nowrap: style.whiteSpace,
          truncated: name.scrollWidth > name.clientWidth,
          width: row.clientWidth,
          scrollWidth: row.scrollWidth,
        };
      }
    );
    return {
      container: rect(container),
      rows,
      documentWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === "http://localhost:4173"
      ? route.continue()
      : route.abort("blockedbyclient")
  );
});

for (const scenario of [
  { name: "desktop-690", width: 960 },
  { name: "nested-420", width: 960, nested: true },
  { name: "phone-390", width: 390 },
  { name: "phone-320", width: 320 },
  { name: "large-english-320", width: 320, fontSize: 20, english: true },
]) {
  test(`attachment rows and grouped actions stay aligned at ${scenario.name}`, async ({
    page,
  }, testInfo) => {
    await decorate(page, scenario);
    const value = await layout(page);
    expect(value.rows).toHaveLength(5);
    expect(value.documentScrollWidth).toBeLessThanOrEqual(
      value.documentWidth + 1
    );
    for (const [index, item] of value.rows.entries()) {
      expect(
        Math.abs(item.row.width - value.container.width)
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(item.row.left - value.container.left)
      ).toBeLessThanOrEqual(1);
      expect(item.scrollWidth).toBeLessThanOrEqual(item.width + 1);
      expect(item.text).toMatch(
        index === 4
          ? /123\.4\s*KB/
          : index === 1
            ? /1\.6\s*KB/
            : index === 3
              ? /5\.6\s*KB/
              : /1\.4\s*KB/
      );
      expect(item.title).toBe(item.nameText);
      expect(item.ellipsis).toBe("ellipsis");
      expect(item.nowrap).toBe("nowrap");
      const previewCenter = item.preview.top + item.preview.height / 2;
      const downloadCenter = item.download.top + item.download.height / 2;
      expect(Math.abs(previewCenter - downloadCenter)).toBeLessThanOrEqual(1);
      expect(item.preview.right).toBeLessThanOrEqual(item.download.left + 1);
      expect(item.download.right).toBeLessThanOrEqual(item.row.right + 1);
      expect(item.preview.left).toBeGreaterThanOrEqual(item.row.left - 1);
      if (index > 0) {
        expect(item.row.top).toBeGreaterThanOrEqual(
          value.rows[index - 1].row.bottom - 1
        );
      }
    }
    expect(value.rows[4].truncated).toBe(true);
    if (scenario.name === "desktop-690") {
      expect(value.rows[0].preview.left).toBeGreaterThan(
        value.rows[0].name.right
      );
    }
    await mkdir(".impeccable/review", { recursive: true });
    await page.locator(".post").screenshot({
      path: `.impeccable/review/attachment-layout-${scenario.name}-${testInfo.project.name}.png`,
    });
  });
}

test("attachment layout preserves deferred loading, original downloads and cooked restoration", async ({
  page,
}) => {
  const deferred = [];
  page.on("request", (request) => {
    if (
      /\/uploads\/|litematic-(?:renderer|worker)\.js|litematic-atlas/.test(
        request.url()
      )
    ) {
      deferred.push(request.url());
    }
  });
  await decorate(page);
  expect(deferred).toEqual([]);
  const first = page.locator(".litematic-attachment").first();
  await expect(
    first.locator(".litematic-attachment__download")
  ).toHaveAttribute("href", "/uploads/short-url/layout-0.litematic");
  await first.locator(".litematic-attachment__preview").click();
  expect(await page.evaluate(() => window.layoutPreviewEvents)).toEqual([
    {
      name: "单片打包.litematic",
      url: "http://localhost:4173/uploads/short-url/layout-0.litematic",
      original: true,
    },
  ]);
  expect(deferred).toEqual([]);
  expect(
    await page
      .locator("#ordinary-attachment")
      .evaluate((node) => getComputedStyle(node, "::before").content)
  ).toBe('"↓"');
  await page.evaluate(() => window.restoreLayout());
  expect(
    await page.evaluate(
      () =>
        document.querySelector(".cooked").innerHTML === window.originalCooked
    )
  ).toBe(true);
  await expect(page.locator(".litematic-attachment")).toHaveCount(0);
});
