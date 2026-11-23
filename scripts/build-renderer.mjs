import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";

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
await writeFile(
  new URL("../assets/THIRD-PARTY-LICENSES.txt", import.meta.url),
  `Three.js (including OrbitControls)\n\n${license}`
);
