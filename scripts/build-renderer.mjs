import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const { buildTextures } = await import("./build-textures.mjs");
await buildTextures();
const { buildModels } = await import("./build-models.mjs");
await buildModels();

await mkdir(new URL("../assets/", import.meta.url), { recursive: true });
for (const [source, name] of [
  ["viewer", "renderer"],
  ["worker", "worker"],
]) {
  await build({
    entryPoints: [`renderer/${source}.mjs`],
    outfile: `assets/litematic-${name}.js`,
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2022"],
    legalComments: "inline",
    banner: {
      js: "/* Bundled locally. Sources: renderer/ · licenses: assets/THIRD-PARTY-LICENSES.txt */",
    },
  });
}
const license = await readFile(
  new URL("../node_modules/three/LICENSE", import.meta.url),
  "utf8"
);
const textureLicense = await readFile(
  new URL("../texture-source/NOTICE.txt", import.meta.url),
  "utf8"
);
const modelLicense = await readFile(
  new URL("../model-source/NOTICE.txt", import.meta.url),
  "utf8"
);
await writeFile(
  new URL("../assets/THIRD-PARTY-LICENSES.txt", import.meta.url),
  `Three.js (including OrbitControls)\n\n${license}\n\nMinecraft texture assets\n\n${textureLicense}\n\nMinecraft model assets\n\n${modelLicense}`
);
