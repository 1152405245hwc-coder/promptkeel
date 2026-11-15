import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { targetPath, hostRoot, hostVersion, backupsDir, ensureDir, ensureNotSymlink, dshHome, VERSION } from "./paths.mjs";
import { diskFs, readHostFileFromAsar, restorePackedAsar, unpackHostAsar } from "./asar.mjs";
import { PATCHES } from "./table.mjs";
import { log, defaultLogFile, setLogFile } from "./log.mjs";

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function parseVersion(v) {
  const m = String(v ?? "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!m) return null;
  const pre = m[4] !== undefined ? m[4].split(".") : null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre,
    hasPre: pre !== null,
  };
}

function cmpPreIdent(a, b) {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) {
    const na = Number(a);
    const nb = Number(b);
    return na === nb ? 0 : na < nb ? -1 : 1;
  }
  if (aNum !== bNum) return aNum ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

function cmpVersion(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  if (!a.hasPre && !b.hasPre) return 0;
  if (!a.hasPre) return 1;
  if (!b.hasPre) return -1;
  const len = Math.min(a.pre.length, b.pre.length);
  for (let i = 0; i < len; i += 1) {
    const d = cmpPreIdent(a.pre[i], b.pre[i]);
    if (d !== 0) return d;
  }
  return a.pre.length === b.pre.length ? 0 : a.pre.length < b.pre.length ? -1 : 1;
}

export function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v) return false;
  for (const part of String(range).trim().split(/\s+/)) {
    if (!part) continue;
    const m = part.match(/^(>=|<=|>|<|=)?\s*([0-9A-Za-z.+\-]+)$/);
    if (!m) return false;
    const op = m[1] || "=";
    const target = parseVersion(m[2]);
    if (!target) return false;
    // In semver, "<0.3.0" excludes "0.3.0-rc.1" as well as "0.3.0".
    if (op === "<" && !target.hasPre && v.major === target.major && v.minor === target.minor && v.patch === target.patch) {
      return false;
    }
    const d = cmpVersion(v, target);
    if (op === ">=" && d < 0) return false;
    if (op === "<=" && d > 0) return false;
    if (op === ">" && d <= 0) return false;
    if (op === "<" && d >= 0) return false;
    if (op === "=" && d !== 0) return false;
  }
  return true;
}

export function resolvePatch(patch, version) {
  if (Array.isArray(patch.variants) && patch.variants.length > 0) {
    const matched = patch.variants.find((v) => !v.versions || satisfies(version, v.versions));
    if (!matched) return { ...patch, unsupported: true };
    return { ...patch, ...matched };
  }
  if (patch.versions && !satisfies(version, patch.versions)) {
    return { ...patch, unsupported: true };
  }
  return patch;
}

export function normalizeFiles(patch) {
  return Array.isArray(patch.file) ? patch.file : [patch.file];
}

export function replacementsOf(patch) {
  if (Array.isArray(patch.replacements)) return patch.replacements;
  return [{ find: patch.find, replace: patch.replace }];
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function isUserDataFile(file) {
  const raw = String(file || "");
  return raw.startsWith("profiles/") || raw.startsWith(".agent-presets/");
}

function readPatchTarget(file, env = {}) {
  const abs = targetPath(file, env);
  const dfs = diskFs();
  if (dfs.existsSync(abs)) {
    return { abs, exists: true, source: "disk", content: dfs.readFileSync(abs, "utf8") };
  }
  if (!isUserDataFile(file)) {
    const fromAsar = readHostFileFromAsar(hostRoot(env), file, "utf8");
    if (fromAsar !== null) {
      return { abs, exists: true, source: "asar", content: fromAsar };
    }
  }
  return { abs, exists: false, source: null, content: null };
}

export function inspectPatch(rawPatch, env = {}) {
  const version = hostVersion(hostRoot(env));
  const patch = resolvePatch(rawPatch, version);
  const base = {
    id: patch.id,
    title: patch.title,
    kind: patch.kind,
    required: patch.required !== false,
    versions: patch.versions,
    why: patch.why,
    hostVersion: version,
    files: [],
    matches: 0,
  };

  if (patch.unsupported) {
    return { ...base, status: "unsupported" };
  }

  let sawHit = false;
  let anyMissing = false;
  let anyMiss = false;

  for (const file of normalizeFiles(patch)) {
    const target = readPatchTarget(file, env);
    if (!target.exists) {
      anyMissing = true;
      base.files.push({ file, abs: target.abs, status: "missing", matches: 0, source: null });
      continue;
    }
    const content = target.content;
    const replacements = replacementsOf(patch);
    const counts = replacements.map((r) => countOccurrences(content, r.find));
    const applied = Boolean(patch.marker) && content.includes(patch.marker) && counts.every((n) => n === 0);
    const matches = counts.length ? Math.min(...counts) : 0;
    let status;
    if (counts.some((n) => n > 1)) status = "ambiguous";
    else if (applied) status = "applied";
    else if (counts.every((n) => n === 1)) status = "hit";
    else if (counts.some((n) => n > 0)) status = "partial";
    else status = "miss";
    if (status === "hit") sawHit = true;
    if (status === "miss") anyMiss = true;
    base.files.push({
      file,
      abs: target.abs,
      status,
      source: target.source,
      matches: status === "ambiguous" ? Math.max(...counts) : matches,
    });
  }

  base.matches = base.files.reduce((sum, f) => sum + (f.matches || 0), 0);
  const states = base.files.map((f) => f.status);
  if (states.includes("ambiguous")) base.status = "ambiguous";
  else if (states.length > 0 && states.every((s) => s === "applied")) base.status = "applied";
  else if (states.length > 0 && states.every((s) => s === "missing")) base.status = "missing";
  else if (states.every((s) => s === "applied" || s === "hit") && states.includes("hit")) base.status = "hit";
  else if (states.includes("applied")) base.status = "partial";
  else if (sawHit && (anyMiss || anyMissing || states.includes("partial"))) base.status = "partial";
  else if (states.includes("partial")) base.status = "partial";
  else if (sawHit) base.status = "hit";
  else if (anyMissing) base.status = "missing";
  else base.status = "miss";
  return base;
}

export function dryRun(patches = PATCHES, env = {}) {
  const results = patches.map((p) => inspectPatch(p, env));
  const ok = results.every((r) => !r.required || r.status === "hit" || r.status === "applied");
  const ready = results.filter((r) => r.status === "hit" || r.status === "applied").length;
  const bad = results.filter((r) => r.required && !["hit", "applied"].includes(r.status)).map((r) => `${r.id}:${r.status}`);
  return {
    ok,
    reason: ok ? null : `preflight-failed (${bad.join(", ")})`,
    message: ok ? `预检通过：${ready}/${results.length} 条就绪` : `预检未通过：${bad.join(", ")}`,
    version: hostVersion(hostRoot(env)),
    patches: results,
  };
}

function backupId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${crypto.randomBytes(3).toString("hex")}`;
}

export function apply(patches = PATCHES, env = {}, options = {}) {
  setLogFile(defaultLogFile(env));
  const dfs = diskFs();
  let report = dryRun(patches, env);
  const blocking = report.patches.filter((p) => p.required && !["hit", "applied"].includes(p.status));
  if (blocking.length > 0) {
    log("apply.blocked", { ids: blocking.map((p) => p.id) }, "error");
    return { ok: false, reason: "preflight-failed", message: report.message, report };
  }

  if (!report.patches.some((p) => p.status === "hit")) {
    return { ok: true, skipped: "already-applied", message: "全部补丁已是已应用状态", id: null, dir: null, changed: [], manifest: null, report };
  }

  let unpacked = null;
  const needsUnpack = report.patches.some((p) => p.status === "hit" && p.files.some((f) => f.source === "asar"));
  if (needsUnpack) {
    if (options.unpack === false) {
      return { ok: false, reason: "asar-packed", message: "宿主仍在 app.asar 中，请先执行 dsh-forge unpack --yes", report };
    }
    try {
      unpacked = unpackHostAsar(env);
    } catch (error) {
      log("apply.unpack-error", { message: error.message }, "error");
      return { ok: false, reason: "unpack-failed", message: `解包 app.asar 失败：${error.message}`, report };
    }
    if (!unpacked.ok) {
      return { ok: false, reason: unpacked.reason || "unpack-failed", message: "解包 app.asar 失败", report };
    }
    log("apply.unpacked", { extracted: unpacked.extracted, appDir: unpacked.appDir });
    report = dryRun(patches, env);
    const postBlocking = report.patches.filter((p) => p.required && !["hit", "applied"].includes(p.status));
    if (postBlocking.length > 0) {
      const rollback = restorePackedAsar(unpacked, env);
      return {
        ok: false,
        reason: "post-unpack-preflight-failed",
        message: `解包后锚点校验失败：${postBlocking.map((p) => `${p.id}:${p.status}`).join(", ")}`,
        report,
        rollback,
      };
    }
  }

  const id = options.id || backupId();
  const root = options.backupRoot || backupsDir(env);
  const dir = path.join(root, id);
  if (dfs.existsSync(dir)) {
    const rollback = restorePackedAsar(unpacked, env);
    return { ok: false, reason: "backup-exists", report, dir, rollback };
  }
  const filesDir = ensureDir(path.join(dir, "files"));
  const manifest = {
    id,
    createdAt: new Date().toISOString(),
    forgeVersion: VERSION,
    hostRoot: hostRoot(env),
    dshHome: dshHome(env),
    hostVersion: report.version,
    unpackedAsar: unpacked?.asarBackup
      ? { appDir: unpacked.appDir, asarPath: unpacked.asarPath, asarBackup: unpacked.asarBackup }
      : null,
    files: [],
    patches: [],
  };

  const seen = new Map();
  for (const result of report.patches) {
    const rawPatch = patches.find((p) => p.id === result.id);
    if (!rawPatch) continue;
    const patch = resolvePatch(rawPatch, report.version);
    const changes = [];
    for (const f of result.files) {
      if (f.status !== "hit") continue;
      changes.push(f.abs);
      if (!seen.has(f.abs)) {
        const index = String(seen.size + 1).padStart(4, "0");
        const backupName = `${index}-${path.basename(f.abs)}`;
        const backupPath = path.join(filesDir, backupName);
        const bytes = dfs.readFileSync(f.abs);
        dfs.writeFileSync(backupPath, bytes);
        seen.set(f.abs, { backupName, sha256: sha256(bytes) });
        manifest.files.push({
          abs: f.abs,
          backup: backupName,
          sha256: sha256(bytes),
          size: bytes.length,
        });
      }
    }
    if (changes.length > 0) manifest.patches.push({ id: patch.id, files: changes });
  }

  dfs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

  const fileEdits = new Map();
  for (const rawPatch of patches) {
    const patch = resolvePatch(rawPatch, report.version);
    const result = report.patches.find((r) => r.id === patch.id);
    if (!result || result.status !== "hit") continue;
    const reps = replacementsOf(patch);
    for (const f of result.files) {
      if (f.status !== "hit") continue;
      if (!fileEdits.has(f.abs)) fileEdits.set(f.abs, []);
      fileEdits.get(f.abs).push(...reps);
    }
  }

  const changed = [];
  const failed = [];
  for (const [abs, reps] of fileEdits.entries()) {
    let content = dfs.readFileSync(abs, "utf8");
    for (const r of reps) {
      content = content.split(r.find).join(r.replace);
    }
    try {
      ensureNotSymlink(abs, dfs);
      const tmp = `${abs}.dshforge.tmp`;
      dfs.writeFileSync(tmp, content);
      dfs.chmodSync(tmp, dfs.statSync(abs).mode);
      dfs.renameSync(tmp, abs);
      const patchedSha256 = sha256(dfs.readFileSync(abs));
      const entry = manifest.files.find((item) => item.abs === abs);
      if (entry) entry.patchedSha256 = patchedSha256;
      changed.push(abs);
    } catch (error) {
      failed.push({ file: abs, reason: "write-failed", message: error.message });
    }
  }

  if (failed.length > 0) {
    for (const abs of changed) {
      const entry = manifest.files.find((item) => item.abs === abs);
      if (!entry) continue;
      try {
        const backupPath = path.join(filesDir, entry.backup);
        if (dfs.existsSync(backupPath)) {
          const tmp = `${abs}.dshforge-rollback.tmp`;
          dfs.writeFileSync(tmp, dfs.readFileSync(backupPath));
          dfs.chmodSync(tmp, dfs.statSync(abs).mode);
          dfs.renameSync(tmp, abs);
        }
      } catch { /* best-effort rollback */ }
    }
    if (unpacked?.asarBackup) unpacked.rollback = restorePackedAsar(unpacked, env);
  }

  dfs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  log("apply.done", { id, changed: changed.length, failed: failed.length, patches: manifest.patches.length });
  return {
    ok: failed.length === 0,
    id,
    dir,
    changed,
    failed,
    unpacked,
    unpackedAsar: manifest.unpackedAsar,
    manifest,
    report,
    message: failed.length === 0
      ? `已应用 ${manifest.patches.length} 条补丁（备份 ${id}）`
      : `部分文件写入失败（${failed.length} 个），已自动回滚修改`,
  };
}

export function listBackups(root = backupsDir()) {
  const dfs = diskFs();
  if (!dfs.existsSync(root)) return [];
  return dfs.readdirSync(root)
    .filter((name) => dfs.existsSync(path.join(root, name, "manifest.json")))
    .sort()
    .reverse()
    .map((name) => {
      let manifest = {};
      try { manifest = JSON.parse(dfs.readFileSync(path.join(root, name, "manifest.json"), "utf8")); }
      catch { manifest = {}; }
      return {
        id: name,
        createdAt: manifest.createdAt || null,
        hostVersion: manifest.hostVersion || null,
        forgeVersion: manifest.forgeVersion || null,
        files: Array.isArray(manifest.files) ? manifest.files.length : 0,
        patches: Array.isArray(manifest.patches) ? manifest.patches.length : 0,
      };
    });
}

export function revert(env = {}, id = null, root = backupsDir(env), options = {}) {
  setLogFile(defaultLogFile(env));
  const dfs = diskFs();
  const backups = listBackups(root);
  const target = id ? backups.find((b) => b.id === id) : backups[0];
  if (!target) return { ok: false, reason: "no-backup" };
  const dir = path.join(root, target.id);
  let manifest;
  try { manifest = JSON.parse(dfs.readFileSync(path.join(dir, "manifest.json"), "utf8")); }
  catch { return { ok: false, reason: "manifest-unreadable", id: target.id }; }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    return { ok: false, reason: "empty-backup", id: target.id };
  }
  const currentVersion = hostVersion(hostRoot(env));
  if (manifest.hostVersion && currentVersion !== "unknown" && manifest.hostVersion !== currentVersion && !options.force) {
    return {
      ok: false,
      reason: "host-version-mismatch",
      id: target.id,
      backupVersion: manifest.hostVersion,
      hostVersion: currentVersion,
    };
  }
  const restored = [];
  const failed = [];
  for (const file of manifest.files) {
    const backupPath = path.join(dir, "files", file.backup);
    if (!dfs.existsSync(backupPath)) {
      failed.push({ file: file.abs, reason: "backup-missing" });
      continue;
    }
    const bytes = dfs.readFileSync(backupPath);
    if (sha256(bytes) !== file.sha256) {
      failed.push({ file: file.abs, reason: "backup-hash-mismatch" });
      continue;
    }
    if (!dfs.existsSync(path.dirname(file.abs))) {
      failed.push({ file: file.abs, reason: "target-dir-missing" });
      continue;
    }
    if (file.patchedSha256 && dfs.existsSync(file.abs) && !options.force) {
      const current = sha256(dfs.readFileSync(file.abs));
      if (current !== file.patchedSha256) {
        failed.push({ file: file.abs, reason: "target-modified-after-apply" });
        continue;
      }
    }
    try {
      ensureNotSymlink(file.abs, dfs);
    } catch (error) {
      failed.push({ file: file.abs, reason: "symlink-target", message: error.message });
      continue;
    }
    const tmp = `${file.abs}.dshforge-restore.tmp`;
    dfs.writeFileSync(tmp, bytes);
    if (dfs.existsSync(file.abs)) dfs.chmodSync(tmp, dfs.statSync(file.abs).mode);
    dfs.renameSync(tmp, file.abs);
    const now = sha256(dfs.readFileSync(file.abs));
    if (now !== file.sha256) failed.push({ file: file.abs, reason: "restore-hash-mismatch" });
    else restored.push(file.abs);
  }
  log("revert.done", { id: target.id, restored: restored.length, failed: failed.length });
  return {
    ok: failed.length === 0,
    id: target.id,
    restored,
    failed,
    message: failed.length === 0 ? `已从备份 ${target.id} 回滚 ${restored.length} 个文件` : `回滚部分失败（${failed.length} 个文件）`,
  };
}

export function upgrade(patches = PATCHES, env = {}, options = {}) {
  const root = options.backupRoot || backupsDir(env);
  const currentVersion = hostVersion(hostRoot(env));
  const backups = listBackups(root);
  const sameHostBackup = backups.find((b) => b.files > 0 && (!b.hostVersion || b.hostVersion === currentVersion));
  const initial = dryRun(patches, env);
  const hasApplied = initial.patches.some((p) => p.status === "applied" || p.status === "partial");

  if (options.dryRun) {
    return {
      ok: initial.ok,
      version: currentVersion,
      forgeVersion: VERSION,
      willRevert: Boolean(sameHostBackup && hasApplied) ? sameHostBackup.id : null,
      patches: initial.patches,
      message: initial.ok ? "升级预检通过" : "升级预检未通过",
    };
  }

  setLogFile(defaultLogFile(env));

  let revertedId = null;
  if (sameHostBackup && hasApplied) {
    const rev = revert(env, sameHostBackup.id, root);
    if (!rev.ok) return { ok: false, reason: `revert-failed:${rev.reason || "unknown"}`, revert: rev };
    revertedId = rev.id;
  }

  const applied = apply(patches, env, { ...options, backupRoot: root });
  log("upgrade.done", { ok: applied.ok, revertedId, appliedId: applied.id || null, hostVersion: currentVersion });
  return {
    ...applied,
    reverted: revertedId,
    hostVersion: currentVersion,
    forgeVersion: VERSION,
    message: applied.ok ? `已刷新补丁（${revertedId ? `先回滚 ${revertedId}，` : ""}新备份 ${applied.id || "无变更"}）` : applied.message,
  };
}

export function verifyApplied(patches = PATCHES, env = {}) {
  const results = patches.map((p) => {
    const result = inspectPatch(p, env);
    return { id: p.id, title: p.title, status: result.status, applied: result.status === "applied" };
  });
  return { ok: results.every((r) => r.applied), patches: results };
}

export function explain(id, env = {}) {
  const rawPatch = PATCHES.find((p) => p.id === id);
  if (!rawPatch) return null;
  const version = hostVersion(hostRoot(env));
  const patch = resolvePatch(rawPatch, version);
  const results = normalizeFiles(patch).map((file) => {
    const target = readPatchTarget(file, env);
    return {
      file,
      abs: target.abs,
      exists: target.exists,
      source: target.source,
      content: target.content,
      preview: target.exists ? target.content.slice(0, 2000) : null,
    };
  });
  return { patch, results };
}
