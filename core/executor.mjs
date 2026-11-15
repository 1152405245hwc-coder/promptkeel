import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { PATCHES } from "../lib/table.mjs";
import { apply as applyPatches, revert as revertPatches, verifyApplied as verifyAppliedPatches } from "../lib/engine.mjs";
import { restorePackedAsar } from "../lib/asar.mjs";
import { fail } from "./errors.mjs";
import { sha256 } from "./prompt.mjs";

export function stateRoot(env = {}) {
  return path.resolve(env.stateRoot || process.env.DSH_FORGE_STATE || path.join(os.homedir(), ".dsh-forge"));
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

function mergeFile(existing, action) {
  if (action.op === "write-file") return action.content;
  if (action.op === "merge-block") return mergeBlock(existing, action.blockId, action.content);
  if (action.op === "merge-json") return mergeJson(existing, action.value);
  if (action.op === "merge-toml") return mergeToml(existing, action.value);
  fail("action-op", `unsupported file action ${action.op}`);
}

function actionPatches(actions) {
  const wanted = new Set();
  for (const action of actions) {
    if (action.op !== "dsh-patches") continue;
    if (action.patches === "all") for (const patch of PATCHES) wanted.add(patch.id);
    else for (const id of action.patches || []) wanted.add(id);
  }
  return PATCHES.filter((patch) => wanted.has(patch.id));
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

/**
 * Apply a compiled plan transactionally. All file bytes are backed up before
 * the first write; any failure restores every touched file.
 */
export function applyPlan(plan, { dryRun = false, env = {}, yes = false } = {}) {
  const fileActions = plan.actions.filter((a) => ["write-file", "merge-block", "merge-json", "merge-toml"].includes(a.op));
  const patches = actionPatches(plan.actions);
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
      dsh: patches.length ? dryRunPatches(patches, env) : null,
      message: "preview only; pass --yes to write",
    };
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
      dshResult = applyPatches(patches, env, { dryRun: false });
      if (!dshResult.ok) fail("dsh-apply", "DSH patch apply failed", { result: dshResult });
      manifest.dsh = {
        backupDir: dshResult.dir,
        hostRoot: dshResult.manifest?.hostRoot || env.hostRoot || null,
        dshHome: dshResult.manifest?.dshHome || env.dshHome || null,
        unpackedAsar: dshResult.unpackedAsar || null,
        patches: patches.map((p) => p.id),
      };
    }
    for (let i = 0; i < fileActions.length; i += 1) {
      const action = fileActions[i];
      const record = manifest.files[i];
      const before = record.existed ? fs.readFileSync(path.join(dir, record.backup)) : Buffer.alloc(0);
      const next = mergeFile(before.toString("utf8"), action);
      if (!record.existed && next.trim() === "") continue;
      const mode = record.existed ? fs.statSync(action.path).mode & 0o777 : 0o644;
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
        const dshEnv = {
          ...env,
          hostRoot: env.hostRoot || manifest.dsh.hostRoot || undefined,
          dshHome: env.dshHome || manifest.dsh.dshHome || undefined,
        };
        const result = revertPatches(dshEnv, path.basename(manifest.dsh.backupDir), path.dirname(manifest.dsh.backupDir), { force: true });
        if (!result.ok) rollbackErrors.push(result);
      } catch (err) { rollbackErrors.push(err.message); }
    }
    if (manifest.dsh?.unpackedAsar) {
      const result = restorePackedAsar(manifest.dsh.unpackedAsar, env);
      if (!result.ok) rollbackErrors.push(result);
    }
    for (const record of [...touched].reverse()) {
      try {
        if (record.existed) {
          const backup = path.join(dir, record.backup);
          if (fs.existsSync(backup)) writeAtomic(record.path, fs.readFileSync(backup), fs.statSync(record.path).mode & 0o777);
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
      drift.push({ path: record.path, reason: "missing" });
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
      if (record.existed) writeAtomic(record.path, fs.readFileSync(path.join(dir, record.backup)), fs.statSync(record.path).mode & 0o777);
      else if (fs.existsSync(record.path)) fs.unlinkSync(record.path);
    } catch (error) { errors.push({ path: record.path, error: error.message }); }
  }
  if (manifest.dsh?.backupDir) {
    const dshEnv = {
      ...env,
      hostRoot: env.hostRoot || manifest.dsh.hostRoot || undefined,
      dshHome: env.dshHome || manifest.dsh.dshHome || undefined,
    };
    const result = revertPatches(dshEnv, path.basename(manifest.dsh.backupDir), path.dirname(manifest.dsh.backupDir), { force });
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
    const patches = PATCHES.filter((patch) => manifest.dsh.patches.includes(patch.id));
    const dshEnv = {
      ...env,
      hostRoot: env.hostRoot || manifest.dsh.hostRoot || undefined,
      dshHome: env.dshHome || manifest.dsh.dshHome || undefined,
    };
    const result = verifyAppliedPatches(patches, dshEnv);
    rows.push({ dsh: true, ok: result.ok, patches: result.patches });
  }
  return { ok: rows.every((row) => row.ok), id, status: manifest.status, rows };
}
