import fs from "node:fs";
import path from "node:path";
import { assert, fail } from "./errors.mjs";
import { PATCHES } from "../lib/table.mjs";

export const PROFILE_SCHEMA = "forge.profile/v1";
export const MODEL_SCHEMA = "forge.model/v1";
export const HOSTS = ["dsh", "claude-code", "codex", "gemini", "opencode", "generic"];
export const TARGET_KINDS = ["markdown-block", "json-merge", "toml-merge", "file", "dsh-patches", "prompt-only"];
export const SCOPES = ["user", "project", "absolute"];
export const SUPPORT_LEVELS = ["verified", "experimental", "unsupported"];
export const EFFECTS = ["P", "T", "S", "W", "M"];
const PATCH_IDS = new Set(PATCHES.map((patch) => patch.id));

export function packageRoot() {
  return path.resolve(import.meta.dirname, "..");
}

export function profilesDir() {
  return path.join(packageRoot(), "profiles");
}

export function modelsDir() {
  return path.join(packageRoot(), "models");
}

export function promptsDir() {
  return path.join(packageRoot(), "prompt");
}

function readJson(file, code) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    fail(code, `cannot read ${file}: ${error.message}`, { file });
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`${code}-json`, `invalid JSON in ${file}: ${error.message}`, { file });
  }
}

function isString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/i;

export function validateModel(model, { file = "<model>" } = {}) {
  assert(model && typeof model === "object" && !Array.isArray(model), "model-invalid", `${file}: model must be an object`);
  assert(model.schema === MODEL_SCHEMA, "model-schema", `${file}: schema must be ${MODEL_SCHEMA}`);
  assert(isString(model.id) && SAFE_ID.test(model.id), "model-invalid", `${file}: id is required and must be alphanumeric`);
  assert(isString(model.prompt) && !model.prompt.includes(".."), "model-invalid", `${file}: prompt is required`);
  assert(Array.isArray(model.hosts) && model.hosts.every((h) => HOSTS.includes(h)), "model-hosts", `${file}: hosts must name known hosts`);
  if (model.effects !== undefined) {
    assert(Array.isArray(model.effects) && model.effects.every((e) => EFFECTS.includes(e)), "model-effects", `${file}: unknown effect code`);
  }
  return model;
}

export function validateProfile(profile, { file = "<profile>" } = {}) {
  assert(profile && typeof profile === "object" && !Array.isArray(profile), "profile-invalid", `${file}: profile must be an object`);
  assert(profile.schema === PROFILE_SCHEMA, "profile-schema", `${file}: schema must be ${PROFILE_SCHEMA}`);
  for (const key of ["id", "name", "version"]) {
    assert(isString(profile[key]), "profile-invalid", `${file}: ${key} is required`);
  }
  assert(SAFE_ID.test(profile.id), "profile-invalid", `${file}: id must be alphanumeric`);
  assert(HOSTS.includes(profile.host), "profile-host", `${file}: unknown host ${JSON.stringify(profile.host)}`);
  assert(profile.model === undefined || isString(profile.model), "profile-model", `${file}: model must be a string`);
  assert(profile.support === undefined || SUPPORT_LEVELS.includes(profile.support), "profile-support", `${file}: bad support level`);
  assert(profile.prompt && typeof profile.prompt === "object", "profile-prompt", `${file}: prompt config is required`);
  assert(isString(profile.prompt.core) && !profile.prompt.core.includes(".."), "profile-prompt", `${file}: prompt.core is required`);
  assert(profile.capabilities && typeof profile.capabilities === "object", "profile-capabilities", `${file}: capabilities are required`);
  for (const [name, level] of Object.entries(profile.capabilities)) {
    assert(SUPPORT_LEVELS.includes(level), "profile-capability", `${file}: capability ${name} has invalid level`);
  }
  assert(Array.isArray(profile.targets) && profile.targets.length > 0, "profile-targets", `${file}: at least one target is required`);
  const seen = new Set();
  profile.targets.forEach((target, index) => {
    const where = `${file}: targets[${index}]`;
    assert(target && typeof target === "object", "target-invalid", `${where} must be an object`);
    assert(TARGET_KINDS.includes(target.kind), "target-kind", `${where} has unknown kind ${JSON.stringify(target.kind)}`);
    assert(SCOPES.includes(target.scope || "project"), "target-scope", `${where} has unknown scope`);
    if (target.kind !== "dsh-patches" && target.kind !== "prompt-only") {
      assert(isString(target.path), "target-path", `${where}.path is required`);
    }
    if (target.kind === "json-merge" || target.kind === "toml-merge") {
      assert(target.value && typeof target.value === "object", "target-value", `${where}.value is required`);
    }
    if (target.kind === "dsh-patches") {
      assert(
        target.patches === "all"
          || (Array.isArray(target.patches)
            && target.patches.length > 0
            && target.patches.every((id) => typeof id === "string" && PATCH_IDS.has(id))),
        "target-patches",
        `${where}.patches must be "all" or a non-empty array of known patch IDs`,
      );
    }
    const key = `${target.scope || "project"}:${target.path || target.kind}`;
    assert(!seen.has(key), "target-duplicate", `${where} duplicates ${key}`);
    seen.add(key);
  });
  return profile;
}

export function loadProfile(idOrPath, { dir = profilesDir() } = {}) {
  const direct = path.isAbsolute(idOrPath) || idOrPath.endsWith(".json");
  const file = direct ? path.resolve(idOrPath) : path.join(dir, `${idOrPath}.json`);
  const profile = readJson(file, "profile-read");
  return validateProfile(profile, { file });
}

export function loadModel(idOrPath, { dir = modelsDir() } = {}) {
  const direct = path.isAbsolute(idOrPath) || idOrPath.endsWith(".json");
  const file = direct ? path.resolve(idOrPath) : path.join(dir, `${idOrPath}.json`);
  const model = readJson(file, "model-read");
  return validateModel(model, { file });
}

export function listProfiles({ dir = profilesDir() } = {}) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const file = path.join(dir, name);
      try {
        return validateProfile(JSON.parse(fs.readFileSync(file, "utf8")), { file });
      } catch (error) {
        return { id: name.replace(/\.json$/, ""), invalid: error.message };
      }
    });
}

export function listModels({ dir = modelsDir() } = {}) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const file = path.join(dir, name);
      try {
        return validateModel(JSON.parse(fs.readFileSync(file, "utf8")), { file });
      } catch (error) {
        return { id: name.replace(/\.json$/, ""), invalid: error.message };
      }
    });
}
