import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fail } from "./errors.mjs";
import { sha256 } from "./prompt.mjs";
import { getProvider } from "./provider.mjs";

export function defaultStateRoot(env = {}) {
  if (env.stateRoot) return path.resolve(env.stateRoot);
  if (process.env.PROMPTKEEL_STATE) return path.resolve(process.env.PROMPTKEEL_STATE);
  if (process.env.DSH_FORGE_KIT_STATE) return path.resolve(process.env.DSH_FORGE_KIT_STATE);
  if (process.env.DSH_FORGE_STATE) return path.resolve(process.env.DSH_FORGE_STATE);
  if (env.home) return path.resolve(env.home, ".promptkeel");
  if (process.env.XDG_STATE_HOME) return path.resolve(process.env.XDG_STATE_HOME, "promptkeel");
  return path.resolve(os.homedir(), ".promptkeel");
}

export function stateRoot(env = {}) {
  return defaultStateRoot(env);
}

function randomId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return `${stamp}-${crypto.randomBytes(3).toString("hex")}`;
}

function sha256Bytes(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function readBytes(file) {
  try {
    return fs.readFileSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function ensureNotSymlink(file) {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) fail("target-symlink", `refusing to write through symlink: ${file}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function writeAtomic(file, data, mode = 0o644) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  ensureNotSymlink(file);
  const tmp = path.join(dir, `.${path.basename(file)}.dshforge-${process.pid}-${crypto.randomBytes(3).toString("hex")}.tmp`);
  fs.writeFileSync(tmp, data, { mode });
  fs.renameSync(tmp, file);
}

const BEGIN = (id) => `<!-- dsh-forge:begin ${id} -->`;
const END = (id) => `<!-- dsh-forge:end ${id} -->`;

export function mergeBlock(existing, blockId, content) {
  const begin = BEGIN(blockId);
  const end = END(blockId);
  const start = existing.indexOf(begin);
  const finish = existing.indexOf(end);
  if (start !== -1 || finish !== -1) {
    if (start === -1 || finish === -1 || finish < start) fail("block-malformed", `managed block ${blockId} is malformed`);
    if (existing.indexOf(begin, start + begin.length) !== -1 || existing.indexOf(end, finish + end.length) !== -1) {
      fail("block-duplicate", `managed block ${blockId} appears more than once`);
    }
    return existing.slice(0, start) + begin + "\n" + content.trimEnd() + "\n" + end + existing.slice(finish + end.length);
  }
  const prefix = existing.length === 0 ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  return `${existing}${prefix}${begin}\n${content.trimEnd()}\n${end}\n`;
}

export function mergeJson(existing, patch) {
  let base = {};
  if (existing.trim()) {
    try {
      base = JSON.parse(existing);
    } catch (error) {
      fail("json-invalid", `existing JSON is invalid: ${error.message}`);
    }
  }
  const merge = (left, right) => {
    if (Array.isArray(right)) return right.slice();
    if (right && typeof right === "object") {
      const out = left && typeof left === "object" && !Array.isArray(left) ? { ...left } : {};
      for (const [key, value] of Object.entries(right)) out[key] = merge(out[key], value);
      return out;
    }
    return right;
  };
  return JSON.stringify(merge(base, patch), null, 2) + "\n";
}

function tomlLiteral(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlLiteral).join(", ")}]`;
  fail("toml-value", `unsupported TOML value for ${JSON.stringify(value)}`);
}

export function mergeToml(existing, patch) {
  const beginMarker = "# dsh-forge:begin config";
  const endMarker = "# dsh-forge:end config";
  const countMarker = (text, marker) => {
    let count = 0;
    let offset = 0;
    while (true) {
      const index = text.indexOf(marker, offset);
      if (index === -1) return count;
      count += 1;
      offset = index + marker.length;
    }
  };
  const beginCount = countMarker(existing, beginMarker);
  const endCount = countMarker(existing, endMarker);
  if (beginCount !== endCount || beginCount > 1) {
    fail("toml-block-malformed", "dsh-forge TOML block must have exactly one begin/end pair");
  }
  if (beginCount === 1) {
    const beginIndex = existing.indexOf(beginMarker);
    const endIndex = existing.indexOf(endMarker);
    if (endIndex < beginIndex) fail("toml-block-malformed", "dsh-forge TOML block markers are out of order");
  }
  const tableMatch = /^[ \t]*\[[^\r\n]+\][ \t]*(?:#.*)?$/m.exec(existing);
  let head = tableMatch ? existing.slice(0, tableMatch.index) : existing;
  const tail = tableMatch ? existing.slice(tableMatch.index) : "";
  const inserted = [];
  for (const [key, value] of Object.entries(patch)) {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) fail("toml-key", `unsupported TOML bare key ${JSON.stringify(key)}`);
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^([ \\t]*)${escaped}[ \\t]*=.*$`, "m");
    const line = `${key} = ${tomlLiteral(value)}`;
    if (pattern.test(head)) head = head.replace(pattern, `$1${line}`);
    else inserted.push(line);
  }
  if (inserted.length) {
    const beginIdx = head.indexOf(beginMarker);
    const endIdx = head.indexOf(endMarker);
    if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
      const prefix = head.slice(0, endIdx).endsWith("\n") ? "" : "\n";
      head = `${head.slice(0, endIdx)}${prefix}${inserted.join("\n")}\n${head.slice(endIdx)}`;
    } else if (beginIdx !== -1 || endIdx !== -1) {
      fail("toml-block-malformed", "dsh-forge TOML block must be entirely before the first table");
    } else {
      const trimmed = head.trimEnd();
      const block = `${beginMarker}\n${inserted.join("\n")}\n${endMarker}\n`;
      head = trimmed.length === 0 ? block : `${trimmed}\n\n${block}`;
    }
  }
  const combined = tail
    ? `${head.trimEnd()}${head.trimEnd().length ? "\n\n" : ""}${tail}`
    : head;
  return combined.endsWith("\n") ? combined : `${combined}\n`;
}

const YAML_KEY = /^[A-Za-z0-9_.-]+$/;

function yamlScalar(value, indent = 0) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return String(value);
  if (typeof value === "string") {
    if (value.includes("\n")) {
      const pad = " ".repeat(indent + 2);
      const body = value.replace(/\r\n/g, "\n").split("\n").map((line) => (line ? `${pad}${line}` : "")).join("\n");
      return `|-\n${body}`;
    }
    return JSON.stringify(value);
  }
  fail("yaml-value", `unsupported YAML scalar ${JSON.stringify(value)}`);
}

function renderYamlEntries(obj, indent = 0) {
  const pad = " ".repeat(indent);
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    if (!YAML_KEY.test(key)) fail("yaml-key", `unsupported YAML key ${JSON.stringify(key)}`);
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${pad}${key}: []`);
        continue;
      }
      lines.push(`${pad}${key}:`);
      for (const item of value) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const nested = renderYamlEntries(item, indent + 4);
          if (nested.length === 0) lines.push(`${pad}  - {}`);
          else {
            lines.push(`${pad}  - ${nested[0].trimStart()}`);
            lines.push(...nested.slice(1));
          }
        } else {
          lines.push(`${pad}  - ${yamlScalar(item, indent + 2)}`);
        }
      }
    } else if (value && typeof value === "object") {
      const keys = Object.keys(value);
      if (keys.length === 0) lines.push(`${pad}${key}: {}`);
      else {
        lines.push(`${pad}${key}:`);
        lines.push(...renderYamlEntries(value, indent + 2));
      }
    } else {
      lines.push(`${pad}${key}: ${yamlScalar(value, indent)}`);
    }
  }
  return lines;
}

function findTopLevelYamlSection(lines, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headerRe = new RegExp(`^${escaped}:(?:\\s*(?:\\{\\}|#.*))?$`);
  const start = lines.findIndex((line) => headerRe.test(line));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === "" || /^[ \t]/.test(line) || /^\s*#/.test(line)) end += 1;
    else break;
  }
  return { start, end };
}

export function mergeYaml(existing, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    fail("yaml-patch", "YAML patch must be a plain object");
  }
  const beginMarker = "# dsh-forge:begin config";
  const endMarker = "# dsh-forge:end config";
  const source = String(existing ?? "").replace(/\r\n/g, "\n");
  const countMarker = (text, marker) => {
    let count = 0;
    let offset = 0;
    while (true) {
      const index = text.indexOf(marker, offset);
      if (index === -1) return count;
      count += 1;
      offset = index + marker.length;
    }
  };
  const beginCount = countMarker(source, beginMarker);
  const endCount = countMarker(source, endMarker);
  if (beginCount !== endCount || beginCount > 1) {
    fail("yaml-block-malformed", "dsh-forge YAML block must have exactly one begin/end pair");
  }
  let baseText = source;
  if (beginCount === 1) {
    const blockRe = /^[ \t]*# dsh-forge:begin config[\s\S]*?^[ \t]*# dsh-forge:end config\n?/m;
    const match = blockRe.exec(source);
    if (!match) fail("yaml-block-malformed", "dsh-forge YAML block markers are out of order");
    baseText = `${source.slice(0, match.index)}${source.slice(match.index + match[0].length)}`.replace(/\n{3,}/g, "\n\n").trimEnd();
    if (baseText) baseText += "\n";
  }

  let baseLines = baseText ? baseText.split("\n") : [];
  if (baseLines.length && baseLines[baseLines.length - 1] === "") baseLines.pop();

  const blockEntries = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!YAML_KEY.test(key)) fail("yaml-key", `unsupported YAML key ${JSON.stringify(key)}`);
    const section = findTopLevelYamlSection(baseLines, key);
    if (section && value && typeof value === "object" && !Array.isArray(value) && Object.keys(patch).length === 1) {
      // Single top-level mapping already exists outside the managed block: strip colliding child keys
      // inside that section and splice an indented managed block at the end of that mapping.
      const before = baseLines.slice(0, section.start + 1);
      if (new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*\\{\\}`).test(before[before.length - 1])) {
        before[before.length - 1] = `${key}:`;
      }
      const children = baseLines.slice(section.start + 1, section.end);
      const after = baseLines.slice(section.end);
      const childIndentMatch = children.map((line) => /^([ \t]+)(?!#)[A-Za-z0-9_.-]+:/.exec(line)).find(Boolean);
      const childIndent = childIndentMatch ? childIndentMatch[1] : "  ";
      const childIndentLen = childIndent.length;
      const patchChildKeys = new Set(Object.keys(value));
      const keptChildren = [];
      let skipping = false;
      for (const line of children) {
        const escapedIndent = childIndent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const m = new RegExp(`^${escapedIndent}([A-Za-z0-9_.-]+):`).exec(line);
        if (m) {
          skipping = patchChildKeys.has(m[1]);
          if (!skipping) keptChildren.push(line);
        } else if (!skipping) {
          keptChildren.push(line);
        }
      }
      const renderedChildren = renderYamlEntries(value, childIndentLen);
      const indentedBlock = [
        `${childIndent}${beginMarker}`,
        ...renderedChildren,
        `${childIndent}${endMarker}`,
      ];
      const nextLines = [...before, ...keptChildren, ...indentedBlock, ...after];
      return `${nextLines.join("\n").trimEnd()}\n`;
    }
    if (section) {
      baseLines.splice(section.start, section.end - section.start);
    }
    blockEntries[key] = value;
  }

  const blockBody = renderYamlEntries(blockEntries, 0);
  const head = baseLines.join("\n").trimEnd();
  const block = `${beginMarker}\n${blockBody.join("\n")}\n${endMarker}\n`;
  return head.length === 0 ? block : `${head}\n\n${block}`;
}

function mergeFile(existing, action) {
  if (action.op === "write-file" || action.op === "write-shim") return action.content;
  if (action.op === "merge-block") return mergeBlock(existing, action.blockId, action.content);
  if (action.op === "merge-json") return mergeJson(existing, action.value);
  if (action.op === "merge-toml") return mergeToml(existing, action.value);
  if (action.op === "merge-yaml") return mergeYaml(existing, action.value);
  fail("action-op", `unsupported file action ${action.op}`);
}

function actionPatches(actions) {
  return actions.filter((action) => action.op === "dsh-patches");
}

function dshProvider(actions) {
  return actions.length ? getProvider("dsh.patches") : null;
}

function previewFile(action) {
  ensureNotSymlink(action.path);
  const before = readBytes(action.path);
  const existing = before ? before.toString("utf8") : "";
  const next = mergeFile(existing, action);
  return {
    path: action.path,
    op: action.op,
    existed: before !== null,
    beforeSha: before ? sha256Bytes(before) : null,
    afterSha: sha256Bytes(Buffer.from(next)),
    changed: before === null || before.toString("utf8") !== next,
  };
}

function previewRecord(preview) {
  if (!preview || typeof preview !== "object") return null;
  if (preview.schema !== "forge.preview/v1") return { code: "preview-schema", message: `unsupported preview ${preview.schema || "(missing)"}` };
  if (!Array.isArray(preview.files)) return { code: "preview-files", message: "preview files must be an array" };
  return null;
}

/**
 * Compare a previously generated dry-run preview with the current files.
 * This is intentionally opt-in so existing callers that apply immediately
 * retain their behavior; callers that show a preview must pass it back.
 */
export function checkPreview(plan, preview) {
  const invalid = previewRecord(preview);
  if (invalid) return { ok: false, ...invalid, conflicts: [] };
  if (preview.planId !== plan.planId) {
    return {
      ok: false,
      code: "preview-plan-mismatch",
      message: `preview belongs to plan ${preview.planId || "(missing)"}, received ${plan.planId}`,
      conflicts: [],
    };
  }
  const conflicts = [];
  for (const expected of preview.files) {
    ensureNotSymlink(expected.path);
    const current = readBytes(expected.path);
    const currentSha = current ? sha256Bytes(current) : null;
    const currentExists = current !== null;
    if (currentExists !== Boolean(expected.existed) || currentSha !== (expected.beforeSha || null)) {
      conflicts.push({
        path: expected.path,
        reason: "modified-after-preview",
        expected: { existed: Boolean(expected.existed), beforeSha: expected.beforeSha || null },
        current: { existed: currentExists, beforeSha: currentSha },
      });
    }
  }
  return conflicts.length
    ? { ok: false, code: "preview-conflict", message: "refusing to overwrite files changed after preview", conflicts }
    : { ok: true, conflicts: [] };
}

const FILE_ACTION_OPS = ["write-file", "write-shim", "merge-block", "merge-json", "merge-toml", "merge-yaml"];

export function previewPlan(plan, { env = {} } = {}) {
  const fileActions = plan.actions.filter((a) => FILE_ACTION_OPS.includes(a.op));
  const patches = actionPatches(plan.actions);
  const provider = dshProvider(patches);
  const changes = fileActions.map(previewFile);
  return {
    ok: !(plan.budget && plan.budget.ok === false),
    dryRun: true,
    planId: plan.planId,
    changes,
    preview: {
      schema: "forge.preview/v1",
      planId: plan.planId,
      createdAt: new Date().toISOString(),
      files: changes.map(({ path: file, op, existed, beforeSha, afterSha }) => ({ path: file, op, existed, beforeSha, afterSha })),
    },
    dsh: patches.length ? provider.preview(patches, env) : null,
    message: "preview only; pass the preview back to applyPlan to enforce SHA conflict checks",
  };
}

/**
 * Apply a compiled plan transactionally. All file bytes are backed up before
 * the first write; any failure restores every touched file.
 */
export function applyPlan(plan, { dryRun = false, env = {}, yes = false, preview = null } = {}) {
  const fileActions = plan.actions.filter((a) => FILE_ACTION_OPS.includes(a.op));
  const patches = actionPatches(plan.actions);
  const provider = dshProvider(patches);
  const previews = fileActions.map(previewFile);
  if (plan.budget && plan.budget.ok === false) {
    return { ok: false, reason: "budget-exceeded", planId: plan.planId, budget: plan.budget, changes: previews };
  }
  if (dryRun || !yes) {
    return {
      ok: true,
      dryRun: true,
      planId: plan.planId,
      changes: previews,
      preview: {
        schema: "forge.preview/v1",
        planId: plan.planId,
        createdAt: new Date().toISOString(),
        files: previews.map(({ path: file, op, existed, beforeSha, afterSha }) => ({ path: file, op, existed, beforeSha, afterSha })),
      },
      dsh: patches.length ? provider.preview(patches, env) : null,
      message: "preview only; pass the preview back to applyPlan to enforce SHA conflict checks",
    };
  }
  if (preview) {
    const checked = checkPreview(plan, preview);
    if (!checked.ok) return { ok: false, planId: plan.planId, ...checked };
  }
  const root = stateRoot(env);
  const id = randomId();
  const dir = path.join(root, "plans", id);
  fs.mkdirSync(path.join(dir, "files"), { recursive: true });
  const manifest = {
    schema: "forge.manifest/v1",
    id,
    planId: plan.planId,
    profile: plan.profile.id,
    host: plan.profile.host,
    createdAt: new Date().toISOString(),
    files: [],
    dsh: null,
    status: "applying",
  };
  const touched = [];
  try {
    for (let i = 0; i < fileActions.length; i += 1) {
      const action = fileActions[i];
      const before = readBytes(action.path);
      const backup = path.join(dir, "files", `${String(i).padStart(3, "0")}.bak`);
      if (before !== null) {
        ensureNotSymlink(action.path);
        fs.writeFileSync(backup, before);
      }
      manifest.files.push({
        path: action.path,
        op: action.op,
        existed: before !== null,
        beforeSha: before ? sha256Bytes(before) : null,
        backup: before === null ? null : path.relative(dir, backup),
        afterSha: null,
      });
      touched.push(manifest.files[manifest.files.length - 1]);
    }
    let dshResult = null;
    if (patches.length) {
      dshResult = provider.apply(patches, env);
      if (!dshResult.ok) fail("dsh-apply", "DSH patch apply failed", { result: dshResult });
      manifest.dsh = {
        backupDir: dshResult.dir,
        hostRoot: dshResult.manifest?.hostRoot || env.hostRoot || null,
        dshHome: dshResult.manifest?.dshHome || env.dshHome || null,
        unpackedAsar: dshResult.unpackedAsar || null,
        patches: dshResult.patches || [],
        provider: provider.id,
      };
    }
    for (let i = 0; i < fileActions.length; i += 1) {
      const action = fileActions[i];
      const record = manifest.files[i];
      const before = record.existed ? fs.readFileSync(path.join(dir, record.backup)) : Buffer.alloc(0);
      const next = mergeFile(before.toString("utf8"), action);
      if (!record.existed && next.trim() === "") continue;
      const defaultMode = action.mode ?? (action.op === "write-shim" ? 0o755 : 0o644);
      const mode = record.existed
        ? ((fs.statSync(action.path).mode & 0o777) | (action.op === "write-shim" ? 0o755 : 0))
        : defaultMode;
      writeAtomic(action.path, Buffer.from(next), mode);
      record.afterSha = sha256Bytes(Buffer.from(next));
    }
    manifest.status = "applied";
    writeAtomic(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    return { ok: true, dryRun: false, planId: plan.planId, id, dir, files: manifest.files, dsh: manifest.dsh };
  } catch (error) {
    const rollbackErrors = [];
    if (manifest.dsh?.backupDir) {
      try {
        const result = provider.revert(manifest.dsh, env, true);
        if (!result.ok) rollbackErrors.push(result);
      } catch (err) { rollbackErrors.push(err.message); }
    }
    for (const record of [...touched].reverse()) {
      try {
        if (record.existed) {
          const backup = path.join(dir, record.backup);
          if (fs.existsSync(backup)) {
            const mode = fs.existsSync(record.path) ? fs.statSync(record.path).mode & 0o777 : 0o644;
            writeAtomic(record.path, fs.readFileSync(backup), mode);
          }
        } else if (fs.existsSync(record.path)) {
          fs.unlinkSync(record.path);
        }
      } catch (err) { rollbackErrors.push(err.message); }
    }
    return { ok: false, code: error.code || "apply-failed", error: error.message, details: error.details || {}, rollbackErrors };
  }
}

function readManifest(id, env = {}) {
  const root = stateRoot(env);
  const file = path.join(root, "plans", id, "manifest.json");
  if (!fs.existsSync(file)) fail("manifest-missing", `no plan manifest ${id}`);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (manifest.schema !== "forge.manifest/v1") fail("manifest-schema", `unsupported manifest ${manifest.schema}`);
  return { manifest, dir: path.dirname(file) };
}

export function listPlans(env = {}) {
  const dir = path.join(stateRoot(env), "plans");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().map((id) => {
    try {
      const { manifest } = readManifest(id, env);
      return { id, profile: manifest.profile, host: manifest.host, createdAt: manifest.createdAt, status: manifest.status, files: manifest.files.length };
    } catch (error) {
      return { id, invalid: error.message };
    }
  });
}

/** Revert one plan, checking every post-apply hash before touching any file. */
export function revertPlan(id, { force = false, env = {} } = {}) {
  const { manifest, dir } = readManifest(id, env);
  if (manifest.status !== "applied") fail("manifest-status", `plan ${id} is not applied`);
  const drift = [];
  for (const record of manifest.files) {
    let stat = null;
    try { stat = fs.lstatSync(record.path); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!record.existed && !stat) continue;
    if (record.existed && !stat) {
      if (!force) drift.push({ path: record.path, reason: "missing" });
      continue;
    }
    if (stat.isSymbolicLink()) {
      drift.push({ path: record.path, reason: "symlink-target" });
      continue;
    }
    const current = sha256Bytes(fs.readFileSync(record.path));
    if (record.afterSha && current !== record.afterSha && !force) drift.push({ path: record.path, reason: "modified-after-apply" });
  }
  if (drift.length) fail("target-modified", "refusing to overwrite files changed after apply", { drift });
  const errors = [];
  for (const record of [...manifest.files].reverse()) {
    try {
      if (fs.existsSync(record.path) && fs.lstatSync(record.path).isSymbolicLink()) {
        throw new Error(`refusing to revert through symlink: ${record.path}`);
      }
      if (record.existed) {
        const mode = fs.existsSync(record.path) ? fs.statSync(record.path).mode & 0o777 : (record.op === "write-shim" ? 0o755 : 0o644);
        writeAtomic(record.path, fs.readFileSync(path.join(dir, record.backup)), mode);
      }
      else if (fs.existsSync(record.path)) fs.unlinkSync(record.path);
    } catch (error) { errors.push({ path: record.path, error: error.message }); }
  }
  if (manifest.dsh?.backupDir) {
    const result = getProvider(manifest.dsh.provider || "dsh.patches").revert(manifest.dsh, env, force);
    if (!result.ok) errors.push({ dsh: result });
  }
  manifest.status = "reverted";
  manifest.revertedAt = new Date().toISOString();
  writeAtomic(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return errors.length ? { ok: false, id, errors } : { ok: true, id, reverted: manifest.files.length + (manifest.dsh ? 1 : 0) };
}

export function verifyPlan(id, env = {}) {
  const { manifest } = readManifest(id, env);
  if (manifest.status !== "applied") return { ok: false, id, status: manifest.status, rows: [] };
  const rows = manifest.files.map((record) => {
    const exists = fs.existsSync(record.path);
    const current = exists ? sha256Bytes(fs.readFileSync(record.path)) : null;
    return { path: record.path, ok: exists && current === record.afterSha, current, expected: record.afterSha };
  });
  if (manifest.dsh?.patches?.length) {
    const result = getProvider(manifest.dsh.provider || "dsh.patches").verify(manifest.dsh, env);
    rows.push({ dsh: true, ok: result.ok, patches: result.patches });
  }
  return { ok: rows.every((row) => row.ok), id, status: manifest.status, rows };
}

/** Verify a compiled plan's internal hashes without touching the host. */
export function verifyCompiled(plan) {
  const rows = [];
  if (!plan?.prompt?.text) rows.push({ ok: false, check: "prompt", reason: "missing prompt text" });
  else rows.push({ ok: sha256(plan.prompt.text) === plan.prompt.sha256, check: "prompt-sha256" });
  if (!plan?.planId) rows.push({ ok: false, check: "plan-id", reason: "missing" });
  if (!Array.isArray(plan?.actions) || plan.actions.length === 0) rows.push({ ok: false, check: "actions", reason: "empty plan" });
  return { ok: rows.every((row) => row.ok), planId: plan?.planId || null, rows };
}

/** Verify an applied plan by reading current target bytes. */
export function verifyApplied(planId, env = {}) {
  return verifyPlan(planId, env);
}
