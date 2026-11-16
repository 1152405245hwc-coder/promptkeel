import fs from "node:fs";
import path from "node:path";
import { assert, fail } from "./errors.mjs";
import { DSH_PATCH_IDS } from "../lib/dsh-contract.mjs";
import { getAdapter } from "../hosts/registry.mjs";

export const PROFILE_SCHEMA = "forge.profile/v1";
export const MODEL_SCHEMA = "forge.model/v1";
export const HOSTS = ["dsh", "claude-code", "codex", "gemini", "opencode", "generic"];
export const TARGET_KINDS = ["markdown-block", "json-merge", "toml-merge", "file", "command", "dsh-patches", "prompt-only"];
export const SCOPES = ["user", "project", "absolute"];
export const SUPPORT_LEVELS = ["verified", "experimental", "unsupported"];
export const RISK_LEVELS = ["low", "medium", "high"];
export const ACTIVATION_EVIDENCE = ["profile", "config", "patches", "session"];
export const ACTIVATION_RESTART = ["required", "optional", "none"];
export const TARGET_CONFLICTS = ["merge", "abort", "replace-managed"];
export const PLATFORM_OS = ["darwin", "linux", "win32"];
export const EFFECTS = ["P", "T", "S", "W", "M"];
const PATCH_IDS = DSH_PATCH_IDS;

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

function isKnownHost(id) {
  if (HOSTS.includes(id)) return true;
  try {
    getAdapter(id);
    return true;
  } catch (error) {
    if (error?.code === "adapter-unknown") return false;
    throw error;
  }
}

export function validateModel(model, { file = "<model>" } = {}) {
  assert(model && typeof model === "object" && !Array.isArray(model), "model-invalid", `${file}: model must be an object`);
  assert(model.schema === MODEL_SCHEMA, "model-schema", `${file}: schema must be ${MODEL_SCHEMA}`);
  assert(isString(model.id) && SAFE_ID.test(model.id), "model-invalid", `${file}: id is required and must be alphanumeric`);
  assert(isString(model.prompt) && !model.prompt.includes(".."), "model-invalid", `${file}: prompt is required`);
  assert(Array.isArray(model.hosts) && model.hosts.every((h) => isKnownHost(h)), "model-hosts", `${file}: hosts must name known hosts`);
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
  assert(isKnownHost(profile.host), "profile-host", `${file}: unknown host ${JSON.stringify(profile.host)}`);
  if (profile.adapter !== undefined) {
    assert(isString(profile.adapter) && SAFE_ID.test(profile.adapter), "profile-adapter", `${file}: adapter must be an alphanumeric id`);
    try {
      getAdapter(profile.adapter);
    } catch (error) {
      if (error?.code === "adapter-unknown") fail("profile-adapter", `${file}: unknown adapter ${JSON.stringify(profile.adapter)}`);
      throw error;
    }
  }
  if (profile.platform !== undefined) {
    assert(profile.platform && typeof profile.platform === "object" && !Array.isArray(profile.platform), "profile-platform", `${file}: platform must be an object`);
    if (profile.platform.os !== undefined) {
      assert(Array.isArray(profile.platform.os) && profile.platform.os.length > 0 && profile.platform.os.every((os) => PLATFORM_OS.includes(os)), "profile-platform", `${file}: platform.os must list known operating systems`);
    }
    if (profile.platform.version !== undefined) {
      assert(profile.platform.version && typeof profile.platform.version === "object" && !Array.isArray(profile.platform.version), "profile-platform", `${file}: platform.version must be an object`);
      for (const key of ["min", "max"]) {
        assert(profile.platform.version[key] === undefined || profile.platform.version[key] === null || isString(profile.platform.version[key]), "profile-platform", `${file}: platform.version.${key} must be a string or null`);
      }
    }
    assert(profile.platform.configSchema === undefined || profile.platform.configSchema === null || isString(profile.platform.configSchema), "profile-platform", `${file}: platform.configSchema must be a string or null`);
  }
  if (profile.activation !== undefined) {
    assert(profile.activation && typeof profile.activation === "object" && !Array.isArray(profile.activation), "profile-activation", `${file}: activation must be an object`);
    if (profile.activation.evidence !== undefined) {
      assert(Array.isArray(profile.activation.evidence) && profile.activation.evidence.length > 0, "profile-activation", `${file}: activation.evidence must be a non-empty array`);
      assert(profile.activation.evidence.every((item) => ACTIVATION_EVIDENCE.includes(item)), "profile-activation", `${file}: unknown activation evidence`);
    }
    if (profile.activation.restart !== undefined) {
      assert(ACTIVATION_RESTART.includes(profile.activation.restart), "profile-activation", `${file}: unknown activation restart policy`);
    }
  }
  assert(profile.model === undefined || isString(profile.model), "profile-model", `${file}: model must be a string`);
  assert(profile.support === undefined || SUPPORT_LEVELS.includes(profile.support), "profile-support", `${file}: bad support level`);
  assert(profile.risk === undefined || RISK_LEVELS.includes(profile.risk), "profile-risk", `${file}: bad risk level`);
  assert(profile.mutatesHost === undefined || typeof profile.mutatesHost === "boolean", "profile-mutates-host", `${file}: mutatesHost must be boolean`);
  assert(profile.requiresRestart === undefined || typeof profile.requiresRestart === "boolean", "profile-restart", `${file}: requiresRestart must be boolean`);
  if (profile.activationEvidence !== undefined) {
    assert(Array.isArray(profile.activationEvidence) && profile.activationEvidence.length > 0, "profile-activation", `${file}: activationEvidence must be a non-empty array`);
    assert(profile.activationEvidence.every((item) => ACTIVATION_EVIDENCE.includes(item)), "profile-activation", `${file}: unknown activation evidence`);
  }
  assert(profile.prompt && typeof profile.prompt === "object", "profile-prompt", `${file}: prompt config is required`);
  assert(isString(profile.prompt.core) && !profile.prompt.core.includes(".."), "profile-prompt", `${file}: prompt.core is required`);
  assert(profile.capabilities && typeof profile.capabilities === "object", "profile-capabilities", `${file}: capabilities are required`);
  for (const [name, level] of Object.entries(profile.capabilities)) {
    assert(SUPPORT_LEVELS.includes(level), "profile-capability", `${file}: capability ${name} has invalid level`);
  }
  assert(Array.isArray(profile.targets) && profile.targets.length > 0, "profile-targets", `${file}: at least one target is required`);
  const seen = new Set();
  const seenIds = new Set();
  profile.targets.forEach((target, index) => {
    const where = `${file}: targets[${index}]`;
    assert(target && typeof target === "object", "target-invalid", `${where} must be an object`);
    assert(TARGET_KINDS.includes(target.kind), "target-kind", `${where} has unknown kind ${JSON.stringify(target.kind)}`);
    if (target.id !== undefined) {
      assert(isString(target.id) && SAFE_ID.test(target.id), "target-id", `${where}.id must be an alphanumeric id`);
      assert(!seenIds.has(target.id), "target-id-duplicate", `${where}.id duplicates ${target.id}`);
      seenIds.add(target.id);
    }
    if (target.required !== undefined) assert(typeof target.required === "boolean", "target-required", `${where}.required must be boolean`);
    if (target.owner !== undefined) assert(isString(target.owner), "target-owner", `${where}.owner must be a non-empty string`);
    if (target.conflict !== undefined) assert(TARGET_CONFLICTS.includes(target.conflict), "target-conflict", `${where}.conflict has unknown strategy`);
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

/** Build the in-memory v1 compatibility shape without rewriting source JSON. */
export function normalizeProfile(profile, { file = "<profile>" } = {}) {
  validateProfile(profile, { file });
  const explicitAdapter = Object.prototype.hasOwnProperty.call(profile, "adapter");
  const explicitActivation = Object.prototype.hasOwnProperty.call(profile, "activation");
  const explicitTargetMetadata = profile.targets.some((target) => ["id", "required", "owner", "conflict"].some((key) => Object.prototype.hasOwnProperty.call(target, key)));
  const activationEvidence = profile.activation?.evidence || profile.activationEvidence || ["config", "session"];
  const restart = profile.activation?.restart
    || (profile.requiresRestart === true ? "required" : profile.requiresRestart === false ? "none" : "optional");
  const normalized = {
    ...profile,
    adapter: profile.adapter || profile.host,
    platform: profile.platform || {},
    activation: {
      ...(profile.activation || {}),
      evidence: activationEvidence,
      restart,
    },
    targets: profile.targets.map((target, index) => ({
      ...target,
      id: target.id || String(index),
      required: target.required ?? true,
      owner: target.owner || "dsh-forge",
      conflict: target.conflict || "merge",
    })),
  };
  Object.defineProperty(normalized, "__adapterExplicit", { value: explicitAdapter, enumerable: false });
  Object.defineProperty(normalized, "__activationExplicit", { value: explicitActivation, enumerable: false });
  Object.defineProperty(normalized, "__targetMetadataExplicit", { value: explicitTargetMetadata, enumerable: false });
  Object.defineProperty(normalized, "sourceSchema", { value: profile.schema, enumerable: false });
  return normalized;
}

export function loadProfile(idOrPath, { dir = profilesDir() } = {}) {
  const direct = path.isAbsolute(idOrPath) || idOrPath.endsWith(".json");
  const file = direct ? path.resolve(idOrPath) : path.join(dir, `${idOrPath}.json`);
  const profile = readJson(file, "profile-read");
  return normalizeProfile(profile, { file });
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
        return normalizeProfile(JSON.parse(fs.readFileSync(file, "utf8")), { file });
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
