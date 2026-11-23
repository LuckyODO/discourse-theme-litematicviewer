import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const modelName = (name) => name.replace(/^minecraft:/, "");

export async function readModelSources({ root = ROOT, version = "26.3" } = {}) {
  if (!/^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/.test(version)) {
    throw new Error("Invalid model source version.");
  }
  const bytes = await readFile(
    path.join(root, "model-source", `${version}.json`)
  );
  if (bytes.length > 32 * 1024 * 1024) {
    throw new Error("Model source container exceeds the build limit.");
  }
  const container = JSON.parse(bytes.toString("utf8"));
  if (
    container.format !== "litematic-model-source-v1" ||
    container.version !== version ||
    !container.files ||
    typeof container.files !== "object" ||
    Array.isArray(container.files)
  ) {
    throw new Error("Invalid model source container.");
  }
  const names = Object.keys(container.files).sort(compare);
  if (!names.length || names.length > 16_384) {
    throw new Error("Model source file count exceeds the build limit.");
  }
  const files = new Map();
  for (const name of names) {
    if (
      !/^(?:blockstates|models\/block)\/(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_-]*\.json$/.test(
        name
      )
    ) {
      throw new Error(`Invalid model source filename: ${name}`);
    }
    const encoded = container.files[name];
    if (typeof encoded !== "string" || encoded.length > 1024 * 1024) {
      throw new Error(`Invalid model source bytes: ${name}`);
    }
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.toString("base64") !== encoded) {
      throw new Error(`Invalid model source base64: ${name}`);
    }
    files.set(name, decoded);
  }
  return files;
}

// Keep shared element templates separate from each model's texture bindings.
// Resolving every state into duplicated faces would make the worker needlessly big.
export function compileModelSources(files, version = "26.3") {
  const rawModels = new Map();
  const rawStates = new Map();
  const sourceHash = createHash("sha256");
  for (const [filename, bytes] of [...files].sort(([a], [b]) =>
    compare(a, b)
  )) {
    sourceHash.update(filename).update("\0").update(bytes).update("\0");
    const value = JSON.parse(bytes.toString("utf8"));
    if (filename.startsWith("models/")) {
      rawModels.set(filename.slice(7, -5), value);
    } else {
      rawStates.set(filename.slice(12, -5), value);
    }
  }
  const inherited = new Map();
  function inherit(name, ancestors = new Set()) {
    if (inherited.has(name)) {
      return inherited.get(name);
    }
    if (ancestors.has(name) || ancestors.size > 64) {
      throw new Error(`Cyclic model parent: ${name}`);
    }
    const raw = rawModels.get(name);
    if (!raw) {
      throw new Error(`Missing model parent: ${name}`);
    }
    const chain = new Set(ancestors).add(name);
    const parent = raw.parent ? inherit(modelName(raw.parent), chain) : {};
    const resolved = {
      elements: raw.elements ?? parent.elements ?? [],
      textures: { ...parent.textures, ...raw.textures },
      ambientocclusion: raw.ambientocclusion ?? parent.ambientocclusion ?? true,
    };
    inherited.set(name, resolved);
    return resolved;
  }
  function texture(value, bindings, chain = new Set()) {
    if (typeof value === "string" && value.startsWith("#")) {
      const key = value.slice(1);
      if (chain.has(key)) {
        throw new Error(`Cyclic model texture: ${key}`);
      }
      return texture(bindings[key], bindings, new Set(chain).add(key));
    }
    if (
      value &&
      typeof value === "object" &&
      typeof value.sprite === "string"
    ) {
      return {
        sprite: modelName(value.sprite),
        translucent: value.force_translucent === true,
      };
    }
    return typeof value === "string"
      ? { sprite: modelName(value), translucent: false }
      : null;
  }
  const geometries = [];
  const geometryIds = new Map();
  const models = [];
  const modelIds = new Map();
  const modelNames = new Map();
  function internModel(name) {
    name = modelName(name);
    if (modelNames.has(name)) {
      return modelNames.get(name);
    }
    const resolved = inherit(name);
    const elements = resolved.elements.map((element) => {
      const result = {
        from: element.from,
        to: element.to,
        faces: element.faces,
      };
      for (const key of [
        "rotation",
        "shade",
        "shade_direction_override",
        "light_emission",
      ]) {
        if (element[key] !== undefined) {
          result[key] = element[key];
        }
      }
      return result;
    });
    const geometryKey = JSON.stringify(elements);
    if (!geometryIds.has(geometryKey)) {
      geometryIds.set(geometryKey, geometries.length);
      geometries.push(elements);
    }
    const textures = {};
    for (const key of Object.keys(resolved.textures).sort(compare)) {
      textures[key] = texture(resolved.textures[key], resolved.textures);
    }
    const model = {
      geometry: geometryIds.get(geometryKey),
      textures,
      ambientocclusion: resolved.ambientocclusion,
    };
    const key = JSON.stringify(model);
    if (!modelIds.has(key)) {
      modelIds.set(key, models.length);
      models.push(model);
    }
    const id = modelIds.get(key);
    modelNames.set(name, id);
    return id;
  }
  function placement(value) {
    if (Array.isArray(value)) {
      return value.map(placement);
    }
    const result = { model: internModel(value.model) };
    for (const key of ["x", "y", "z", "uvlock", "weight"]) {
      if (value[key] !== undefined) {
        result[key] = value[key];
      }
    }
    return result;
  }
  const states = {};
  for (const [name, state] of rawStates) {
    states[name] = state.variants
      ? {
          variants: Object.entries(state.variants).map(([when, apply]) => [
            when,
            placement(apply),
          ]),
        }
      : {
          multipart: state.multipart.map((part) => ({
            ...(part.when ? { when: part.when } : {}),
            apply: placement(part.apply),
          })),
        };
  }
  return {
    version,
    sourceSha256: sourceHash.digest("hex"),
    states,
    geometries,
    models,
  };
}

export async function buildModelData({ root = ROOT } = {}) {
  const provenance = JSON.parse(
    await readFile(path.join(root, "model-source/source.json"), "utf8")
  );
  const data = compileModelSources(
    await readModelSources({ root, version: provenance.version }),
    provenance.version
  );
  const bytes = Buffer.from(
    "// Generated by scripts/build-models.mjs. Model resource copyright: model-source/LICENSE.md.\n" +
      `export const BLOCK_MODELS = ${JSON.stringify(data)};\n`
  );
  if (bytes.length > 4 * 1024 * 1024) {
    throw new Error("Generated model data exceeds the 4 MiB worker budget.");
  }
  return { data, bytes };
}

export async function buildModels({ check = false } = {}) {
  const { data, bytes } = await buildModelData();
  const filename = path.join(ROOT, "renderer/generated/block-models.mjs");
  if (check) {
    if (!(await readFile(filename).catch(() => null))?.equals(bytes)) {
      throw new Error(
        "Block model data is stale. Run node scripts/build-models.mjs."
      );
    }
  } else {
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, bytes);
  }
  process.stdout.write(
    `${check ? "Verified" : "Built"} Minecraft Java ${data.version} block models: ${Object.keys(data.states).length} blockstates, ${data.models.length} models, ${data.geometries.length} shared geometries, ${bytes.length} bytes.\n`
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await buildModels({ check: process.argv.slice(2).includes("--check") });
}
