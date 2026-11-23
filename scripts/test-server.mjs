import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "sass";
import { createLitematicFixture } from "../test/fixtures/litematic-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.PORT || 4173);
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://localhost:${port}`);
    if (url.pathname === "/uploads/short-url/pavilion") {
      const bytes = createLitematicFixture();
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": bytes.length,
      });
      response.end(bytes);
      return;
    }
    if (url.pathname === "/theme.css") {
      response.writeHead(200, { "Content-Type": "text/css" });
      response.end(compile(path.join(root, "common/common.scss")).css);
      return;
    }
    const pathname =
      url.pathname === "/" ? "/test/browser/harness.html" : url.pathname;
    const absolute = path.resolve(root, `.${decodeURIComponent(pathname)}`);
    const relative = path.relative(root, absolute);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      !/^(test[\\/]browser|javascripts)[\\/]/.test(relative)
    ) {
      response.writeHead(404).end();
      return;
    }
    const content = await readFile(absolute);
    response.writeHead(200, {
      "Content-Type":
        mime[path.extname(absolute)] || "application/octet-stream",
    });
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(port, "0.0.0.0", () =>
  process.stdout.write(`Browser harness: http://localhost:${port}\n`)
);
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
