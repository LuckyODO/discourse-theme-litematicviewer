import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import test from "node:test";
import {
  attachmentName,
  attachmentURL,
  decorateAttachments,
  topicIdentity,
} from "../../javascripts/discourse/lib/litematic-attachments.js";

function fixture(html) {
  const dom = new JSDOM(`<div class="cooked">${html}</div>`, {
    url: "https://forum.example/t/test/123",
  });
  return dom.window.document.querySelector(".cooked");
}

const labels = { preview: "3D preview", download: "Download" };

test("upload sizes move inside the row without consuming following prose and restore exactly", () => {
  for (const size of [
    "1.4 KB",
    "236 Bytes",
    "16 B",
    "1,2\u00a0MB",
    "2.5 MiB",
    "236 字节",
  ]) {
    const root = fixture(
      `<p><a class="attachment" href="/a.litematic">a.litematic</a> (${size}) additional instructions<br><a class="attachment" href="/b.litematic">b.litematic</a> (2 KB)</p>`
    );
    const originalHTML = root.innerHTML;
    const anchor = root.querySelector("a");
    const text = anchor.nextSibling;
    const cleanup = decorateAttachments(root, { labels, onPreview() {} });
    const card = root.querySelector(".litematic-attachment");
    assert.equal(
      card.querySelector(".litematic-attachment__size").textContent,
      size
    );
    assert.equal(
      card.querySelector(".litematic-attachment__actions a"),
      anchor
    );
    assert.equal(card.nextSibling, text);
    assert.equal(text.data, " additional instructions");
    assert.equal(card.textContent.includes("additional instructions"), false);
    cleanup();
    assert.equal(root.innerHTML, originalHTML);
    assert.equal(anchor.nextSibling, text);
  }
});

test("ordinary adjacent prose, elements and metadata for other file types are untouched", () => {
  const root = fixture(
    '<a class="attachment" href="/a.litematic">a.litematic</a> (requires version 26.3)<br><a class="attachment" href="/b.litematic">b.litematic</a><em> (2 MB)</em><a class="attachment" href="/c.zip">c.zip</a> (4 KB)'
  );
  const originalHTML = root.innerHTML;
  const cleanup = decorateAttachments(root, { labels, onPreview() {} });
  assert.equal(root.querySelectorAll(".litematic-attachment__size").length, 0);
  assert.equal(
    root.querySelector(".litematic-attachment").nextSibling.data,
    " (requires version 26.3)"
  );
  assert.equal(root.querySelector("em").textContent, " (2 MB)");
  assert.equal(
    root.querySelector('a[href="/c.zip"]').nextSibling.data,
    " (4 KB)"
  );
  cleanup();
  assert.equal(root.innerHTML, originalHTML);
});

test("normalization and repeated decoration cannot duplicate or lose the original upload size", () => {
  const root = fixture(
    '<p><a class="attachment" href="/a.litematic">a.litematic</a> (1.4 KB)<br>Following line</p>'
  );
  const originalHTML = root.innerHTML;
  for (let repeat = 0; repeat < 3; repeat++) {
    const cleanup = decorateAttachments(root, { labels, onPreview() {} });
    const redundant = decorateAttachments(root, { labels, onPreview() {} });
    redundant();
    root.normalize();
    cleanup();
    assert.equal(root.innerHTML, originalHTML);
  }
});

test("only uploaded litematic attachments are decorated, including uppercase names", () => {
  const root = fixture(`
    <a class="attachment" href="/uploads/short-url/one">城堡.LITEMATIC</a>
    <a class="attachment" href="/uploads/file.zip">file.zip</a>
    <a href="https://external.example/build.litematic">an external link</a>
    <code><a class="attachment" href="/uploads/code.litematic">code.litematic</a></code>
  `);
  decorateAttachments(root, { labels, onPreview() {} });
  assert.equal(root.querySelectorAll(".litematic-attachment").length, 1);
  assert.equal(
    root.querySelector(".litematic-attachment__name").textContent,
    "城堡.LITEMATIC"
  );
  assert.equal(root.querySelectorAll("a").length, 4);
});

test("decoration preserves the original anchor and resolves its current URL on click", () => {
  const root = fixture(
    '<a class="attachment" href="/404" data-orig-href="upload://hash.litematic">Castle.litematic</a>'
  );
  const original = root.querySelector("a");
  let received;
  const cleanup = decorateAttachments(root, {
    labels,
    onPreview(value) {
      received = value;
    },
  });
  assert.equal(root.querySelector("a"), original);
  assert.equal(attachmentURL(original), null);
  original.href = "/secure-uploads/castle?token=fresh";
  original.removeAttribute("data-orig-href");
  root.querySelector("button").click();
  assert.equal(received.anchor, original);
  assert.equal(received.name, "Castle.litematic");
  assert.equal(
    attachmentURL(received.anchor),
    "https://forum.example/secure-uploads/castle?token=fresh"
  );
  cleanup();
  assert.equal(original.textContent, "Castle.litematic");
  assert.equal(
    original.getAttribute("href"),
    "/secure-uploads/castle?token=fresh"
  );
  assert.equal(original.hasAttribute("data-orig-href"), false);
});

test("repeated decoration is idempotent and cleanup restores nodes and attributes", () => {
  const root = fixture(
    '<a class="attachment custom" href="/a.litematic" title="Original"><strong>a.litematic</strong></a>'
  );
  const anchor = root.querySelector("a");
  const strong = root.querySelector("strong");
  let clicks = 0;
  const options = {
    labels,
    onPreview() {
      clicks++;
    },
  };
  const cleanup = decorateAttachments(root, options);
  const secondCleanup = decorateAttachments(root, options);
  assert.equal(root.querySelectorAll("button").length, 1);
  const button = root.querySelector("button");
  button.click();
  assert.equal(clicks, 1);
  secondCleanup();
  assert.equal(root.querySelectorAll("button").length, 1);
  cleanup();
  cleanup();
  button.click();
  assert.equal(clicks, 1);
  assert.equal(root.querySelector("a"), anchor);
  assert.equal(root.querySelector("strong"), strong);
  assert.equal(anchor.className, "attachment custom");
  assert.equal(anchor.title, "Original");
  assert.equal(anchor.hasAttribute("download"), false);
  assert.equal(root.querySelectorAll("button").length, 0);
});

test("encoded URL names work and attacker-controlled filenames remain text", () => {
  const root = fixture(
    '<a class="attachment" href="/uploads/%E5%9F%8E%E5%A0%A1.litematic?dl=1">Download</a>'
  );
  assert.equal(attachmentName(root.querySelector("a")), "城堡.litematic");
  root.querySelector("a").textContent =
    "<img src=x onerror=alert(1)>.litematic";
  decorateAttachments(root, { labels, onPreview() {} });
  assert.equal(root.querySelector("img"), null);
  assert.match(
    root.querySelector(".litematic-attachment__name").textContent,
    /<img/
  );
});

test("invalid or unresolved attachment URLs cannot start a download", () => {
  /* eslint-disable no-script-url -- An intentionally rejected adversarial URL. */
  for (const href of [
    "",
    "   ",
    "javascript:alert(1)",
    "data:text/plain,test",
    "/404",
    "https://user:pass@example.com/file",
  ]) {
    const root = fixture('<a class="attachment">a.litematic</a>');
    const anchor = root.querySelector("a");
    anchor.setAttribute("href", href);
    assert.equal(attachmentURL(anchor), null);
  }
  assert.equal(
    attachmentURL(
      fixture('<a class="attachment">a.litematic</a>').querySelector("a")
    ),
    null
  );
});

test("post scrolling preserves topic identity while navigation changes it", () => {
  const base = "https://forum.example";
  assert.equal(
    topicIdentity("/t/castle/123/7", base),
    topicIdentity("/t/castle/123", base)
  );
  assert.equal(topicIdentity("/community/t/castle/123/7", base), "topic:123");
  assert.equal(topicIdentity("/t/123/7", base), "topic:123");
  assert.notEqual(topicIdentity("/t/other/124", base), "topic:123");
  assert.equal(topicIdentity("/latest", base), "/latest");
});
