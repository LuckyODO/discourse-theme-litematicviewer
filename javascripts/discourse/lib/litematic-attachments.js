const EXTENSION = /\.litematic$/i;

function decoded(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function attachmentName(anchor) {
  const text = anchor.textContent.trim();
  if (EXTENSION.test(text)) {
    return text;
  }

  for (const value of [
    anchor.getAttribute("download"),
    anchor.getAttribute("data-orig-href"),
    anchor.getAttribute("href"),
  ]) {
    const name = decoded((value || "").split(/[?#]/)[0].split("/").pop());
    if (EXTENSION.test(name)) {
      return name;
    }
  }
}

// Read at click time: Discourse may resolve upload:// links after decoration.
export function attachmentURL(anchor) {
  const href = anchor.getAttribute("href");
  if (!href?.trim() || anchor.hasAttribute("data-orig-href")) {
    return null;
  }
  try {
    const url = new URL(href, anchor.ownerDocument.baseURI);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      /\/404\/?$/.test(url.pathname)
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export function topicIdentity(value, base) {
  const path = new URL(value, base).pathname;
  const topic = path.match(
    /\/t\/(?:(?!\d+(?:\/|$))[^/]+\/)?(\d+)(?:\/\d+)?\/?$/
  );
  return topic ? `topic:${topic[1]}` : path;
}

export function decorateAttachments(element, { labels, onPreview }) {
  const restorers = [];
  const doc = element.ownerDocument;

  for (const anchor of element.querySelectorAll("a.attachment")) {
    if (anchor.closest(".litematic-attachment, pre, code")) {
      continue;
    }
    const name = attachmentName(anchor);
    if (!name) {
      continue;
    }

    const children = Array.from(anchor.childNodes);
    const attributes = ["class", "title", "aria-label", "download"].map(
      (attribute) => [attribute, anchor.getAttribute(attribute)]
    );
    const wrapper = doc.createElement("span");
    wrapper.className = "litematic-attachment";

    const filename = doc.createElement("span");
    filename.className = "litematic-attachment__name";
    filename.textContent = name;
    filename.title = name;

    const preview = doc.createElement("button");
    preview.type = "button";
    preview.className = "btn btn-primary litematic-attachment__preview";
    preview.textContent = labels.preview;
    preview.setAttribute("aria-label", `${labels.preview}: ${name}`);
    preview.setAttribute("aria-haspopup", "dialog");
    const click = () => onPreview({ anchor, name });
    preview.addEventListener("click", click);

    anchor.before(wrapper);
    // Keep the actual anchor so Discourse's short-URL resolver and download
    // handlers continue to operate on the original node and permission URL.
    anchor.classList.add(
      "btn",
      "btn-default",
      "litematic-attachment__download"
    );
    anchor.textContent = labels.download;
    anchor.setAttribute("aria-label", `${labels.download}: ${name}`);
    anchor.setAttribute("title", name);
    anchor.setAttribute("download", name);
    wrapper.append(filename, preview, anchor);

    restorers.push(() => {
      preview.removeEventListener("click", click);
      anchor.replaceChildren(...children);
      for (const [attribute, value] of attributes) {
        if (value === null) {
          anchor.removeAttribute(attribute);
        } else {
          anchor.setAttribute(attribute, value);
        }
      }
      // Do not restore href/data-orig-href: core may have updated them.
      wrapper.replaceWith(anchor);
    });
  }

  return () => restorers.splice(0).forEach((restore) => restore());
}
