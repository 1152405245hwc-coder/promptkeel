import nodeFs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { hostRoot, forgeDir, ensureDir } from "./paths.mjs";

let cachedDiskFs;

export function diskFs() {
  if (cachedDiskFs) return cachedDiskFs;
  try {
    cachedDiskFs = createRequire(import.meta.url)("original-fs");
  } catch {
    cachedDiskFs = nodeFs;
  }
  return cachedDiskFs;
}

const headerCache = new Map();

export function resolveAsarLayout(root = hostRoot()) {
  const norm = path.resolve(String(root || ""));
  const base = path.basename(norm);
  const parent = path.dirname(norm);
  if (base === "dsh" && path.basename(parent) === "app") {
    const resourcesDir = path.dirname(parent);
    return {
      root: norm,
      appDir: parent,
      resourcesDir,
      asarPath: path.join(resourcesDir, "app.asar"),
      unpackedDir: path.join(resourcesDir, "app.asar.unpacked"),
      prefix: "dsh",
    };
  }
  const resourcesDir = parent;
  return {
    root: norm,
    appDir: norm,
    resourcesDir,
    asarPath: path.join(resourcesDir, "app.asar"),
    unpackedDir: path.join(resourcesDir, "app.asar.unpacked"),
    prefix: "",
  };
}

export function isAsarFile(asarPath) {
  try {
    const dfs = diskFs();
    return Boolean(asarPath) && dfs.existsSync(asarPath) && dfs.statSync(asarPath).isFile();
  } catch {
    return false;
  }
}

export function asarIdentity(asarPath) {
  try {
    const st = diskFs().statSync(asarPath);
    if (!st.isFile()) return null;
    return { size: st.size, mtimeMs: Math.round(st.mtimeMs) };
  } catch {
    return null;
  }
}

export function readAsarIndex(asarPath) {
  const dfs = diskFs();
  const id = asarIdentity(asarPath);
  if (!id) return null;
  const cached = headerCache.get(asarPath);
  if (cached && cached.size === id.size && cached.mtimeMs === id.mtimeMs) {
    return cached;
  }
  const fd = dfs.openSync(asarPath, "r");
  try {
    const pre = Buffer.alloc(16);
    if (dfs.readSync(fd, pre, 0, 16, 0) !== 16) throw new Error("asar header truncated");
    if (pre.readUInt32LE(0) !== 4) throw new Error("invalid asar header magic");
    const headerSize = pre.readUInt32LE(4);
    const jsonSize = pre.readUInt32LE(12);
    if (!headerSize || !jsonSize || jsonSize > 128 * 1024 * 1024) {
      throw new Error("invalid asar header size");
    }
    const jsonBuf = Buffer.alloc(jsonSize);
    if (dfs.readSync(fd, jsonBuf, 0, jsonSize, 16) !== jsonSize) {
      throw new Error("asar header json truncated");
    }
    const header = JSON.parse(jsonBuf.toString("utf8"));
    const entry = {
      asarPath,
      size: id.size,
      mtimeMs: id.mtimeMs,
      header,
      dataOffset: 8 + headerSize,
    };
    headerCache.set(asarPath, entry);
    return entry;
  } finally {
    dfs.closeSync(fd);
  }
}

function lookupNode(header, relPath) {
  const parts = String(relPath || "").replace(/\\/g, "/").split("/").filter(Boolean);
  let cur = header;
  for (const part of parts) {
    if (!cur || !cur.files || !Object.prototype.hasOwnProperty.call(cur.files, part)) {
      return null;
    }
    cur = cur.files[part];
  }
  return cur || null;
}

export function readAsarFile(asarPath, relPath, encoding = "utf8") {
  const dfs = diskFs();
  const idx = readAsarIndex(asarPath);
  if (!idx) return null;
  const cleanRel = String(relPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const node = lookupNode(idx.header, cleanRel);
  if (!node || node.files) return null;
  if (node.unpacked) {
    const unpackedFile = path.join(`${asarPath}.unpacked`, ...cleanRel.split("/"));
    if (!dfs.existsSync(unpackedFile)) return null;
    const buf = dfs.readFileSync(unpackedFile);
    return encoding ? buf.toString(encoding) : buf;
  }
  const size = Number(node.size || 0);
  const offset = idx.dataOffset + Number(node.offset || 0);
  const buf = Buffer.alloc(size);
  if (size > 0) {
    const fd = dfs.openSync(asarPath, "r");
    try {
      const n = dfs.readSync(fd, buf, 0, size, offset);
      if (n !== size) throw new Error(`asar short read: ${cleanRel}`);
    } finally {
      dfs.closeSync(fd);
    }
  }
  return encoding ? buf.toString(encoding) : buf;
}

export function readHostFileFromAsar(root, relFile, encoding = "utf8") {
  const layout = resolveAsarLayout(root);
  if (!isAsarFile(layout.asarPath)) return null;
  const rel = String(relFile || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const candidates = layout.prefix ? [`${layout.prefix}/${rel}`, rel] : [rel];
  for (const candidate of candidates) {
    const content = readAsarFile(layout.asarPath, candidate, encoding);
    if (content !== null) return content;
  }
  return null;
}

export function hostStorageState(root = hostRoot()) {
  const dfs = diskFs();
  const layout = resolveAsarLayout(root);
  const unpackedReady = dfs.existsSync(path.join(layout.root, "node_modules", "@deepseek-ai"));
  const asarPresent = isAsarFile(layout.asarPath);
  if (unpackedReady && !asarPresent) {
    return { mode: "unpacked", root: layout.root, asarPath: layout.asarPath, appDir: layout.appDir };
  }
  if (asarPresent) {
    return {
      mode: unpackedReady ? "shadowed" : "asar",
      root: layout.root,
      asarPath: layout.asarPath,
      appDir: layout.appDir,
    };
  }
  return { mode: "missing", root: layout.root, asarPath: layout.asarPath, appDir: layout.appDir };
}

function walkHeader(node, prefix, out) {
  const files = node && node.files;
  if (!files) return;
  for (const [name, info] of Object.entries(files)) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (info && info.files) walkHeader(info, rel, out);
    else if (info) out.push({ rel, info });
  }
}

function copyRangeToFile(dfs, fd, offset, size, outPath, executable = false) {
  const outFd = dfs.openSync(outPath, "w", executable ? 0o755 : 0o644);
  try {
    const buf = Buffer.alloc(Math.min(1024 * 1024, Math.max(size, 1)));
    let left = size;
    let pos = offset;
    while (left > 0) {
      const n = dfs.readSync(fd, buf, 0, Math.min(buf.length, left), pos);
      if (n <= 0) throw new Error(`asar short read at ${outPath}`);
      dfs.writeSync(outFd, buf, 0, n);
      pos += n;
      left -= n;
    }
  } finally {
    dfs.closeSync(outFd);
  }
}

function overlayUnpackedDir(dfs, unpackedDir, destDir) {
  if (!dfs.existsSync(unpackedDir)) return 0;
  let copied = 0;
  const walk = (dir) => {
    for (const ent of dfs.readdirSync(dir, { withFileTypes: true })) {
      const from = path.join(dir, ent.name);
      const to = path.join(destDir, path.relative(unpackedDir, from));
      if (ent.isDirectory()) {
        dfs.mkdirSync(to, { recursive: true });
        walk(from);
      } else if (ent.isFile()) {
        dfs.mkdirSync(path.dirname(to), { recursive: true });
        dfs.copyFileSync(from, to);
        copied += 1;
      }
    }
  };
  walk(unpackedDir);
  return copied;
}

export function unpackHostAsar(env = {}, options = {}) {
  const dfs = diskFs();
  const root = hostRoot(env);
  const layout = resolveAsarLayout(root);
  if (!isAsarFile(layout.asarPath)) {
    if (dfs.existsSync(path.join(layout.root, "node_modules", "@deepseek-ai"))) {
      return { ok: true, skipped: "already-unpacked", appDir: layout.appDir, asarPath: layout.asarPath };
    }
    return { ok: false, reason: "asar-not-found", asarPath: layout.asarPath };
  }

  const idx = readAsarIndex(layout.asarPath);
  if (!idx || !idx.header) return { ok: false, reason: "asar-index-unreadable", asarPath: layout.asarPath };
  const entries = [];
  walkHeader(idx.header, "", entries);
  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      asarPath: layout.asarPath,
      appDir: layout.appDir,
      files: entries.length,
    };
  }

  const stageDir = `${layout.appDir}.dshforge-next`;
  const prevDir = `${layout.appDir}.dshforge-prev`;
  dfs.rmSync(stageDir, { recursive: true, force: true });

  let extracted = 0;
  const fd = dfs.openSync(layout.asarPath, "r");
  try {
    dfs.mkdirSync(stageDir, { recursive: true });
    const destResolved = path.resolve(stageDir);
    for (const { rel, info } of entries) {
      const outPath = path.resolve(stageDir, ...rel.split("/"));
      if (outPath !== destResolved && !outPath.startsWith(destResolved + path.sep)) continue;
      dfs.mkdirSync(path.dirname(outPath), { recursive: true });
      if (info.unpacked) continue;
      if (typeof info.link === "string") {
        const linkTarget = path.resolve(path.dirname(outPath), info.link);
        if (linkTarget === destResolved || linkTarget.startsWith(destResolved + path.sep)) {
          try { dfs.symlinkSync(info.link, outPath); } catch { /* ignore */ }
        }
        continue;
      }
      const size = Number(info.size || 0);
      const offset = idx.dataOffset + Number(info.offset || 0);
      if (size === 0) dfs.writeFileSync(outPath, Buffer.alloc(0));
      else copyRangeToFile(dfs, fd, offset, size, outPath, Boolean(info.executable));
      extracted += 1;
    }
    overlayUnpackedDir(dfs, layout.unpackedDir, stageDir);
    const appRoot = layout.prefix ? path.join(stageDir, layout.prefix) : stageDir;
    const required = [
      path.join(appRoot, "package.json"),
      path.join(appRoot, "node_modules", "@deepseek-ai"),
    ];
    const missing = required.filter((entry) => !dfs.existsSync(entry));
    if (missing.length > 0) {
      throw new Error(`unpack incomplete: missing ${missing.map((entry) => path.relative(stageDir, entry)).join(", ")}`);
    }
  } catch (err) {
    dfs.rmSync(stageDir, { recursive: true, force: true });
    throw err;
  } finally {
    dfs.closeSync(fd);
  }

  dfs.rmSync(prevDir, { recursive: true, force: true });
  if (dfs.existsSync(layout.appDir)) dfs.renameSync(layout.appDir, prevDir);
  try {
    dfs.renameSync(stageDir, layout.appDir);
  } catch (err) {
    if (dfs.existsSync(prevDir) && !dfs.existsSync(layout.appDir)) {
      dfs.renameSync(prevDir, layout.appDir);
    }
    throw err;
  }
  let asarBackup = null;
  if (options.retireAsar !== false) {
    asarBackup = `${layout.asarPath}.bak`;
    try {
      if (dfs.existsSync(asarBackup)) dfs.rmSync(asarBackup, { force: true });
      dfs.renameSync(layout.asarPath, asarBackup);
      headerCache.delete(layout.asarPath);
    } catch (error) {
      try {
        dfs.rmSync(layout.appDir, { recursive: true, force: true });
        if (dfs.existsSync(prevDir)) dfs.renameSync(prevDir, layout.appDir);
      } catch { /* best effort */ }
      throw new Error(`cannot retire app.asar (is DSH still running?): ${error.message}`);
    }
  }

  const stampPath = path.join(ensureDir(forgeDir(env)), "unpacked-asar.json");
  dfs.writeFileSync(stampPath, JSON.stringify({
    size: idx.size,
    mtimeMs: idx.mtimeMs,
    unpackedAt: new Date().toISOString(),
    asarBackup,
  }, null, 2));

  return {
    ok: true,
    extracted,
    appDir: layout.appDir,
    asarPath: layout.asarPath,
    asarBackup,
  };
}

/** Restore the packed host after an unpacked operation fails before commit. */
export function restorePackedAsar(unpacked, env = {}) {
  if (!unpacked?.asarBackup) return { ok: true, skipped: "not-unpacked" };
  const dfs = diskFs();
  const appDir = unpacked.appDir;
  const asarPath = unpacked.asarPath;
  const asarBackup = unpacked.asarBackup;
  const quarantine = `${appDir}.dshforge-rollback`;
  try {
    if (!dfs.existsSync(asarBackup)) return { ok: false, reason: "asar-backup-missing", asarBackup };
    dfs.rmSync(quarantine, { recursive: true, force: true });
    if (dfs.existsSync(appDir)) dfs.renameSync(appDir, quarantine);
    dfs.renameSync(asarBackup, asarPath);
    headerCache.delete(asarPath);
    if (dfs.existsSync(quarantine)) dfs.rmSync(quarantine, { recursive: true, force: true });
    const stampPath = path.join(forgeDir(env), "unpacked-asar.json");
    if (dfs.existsSync(stampPath)) dfs.rmSync(stampPath, { force: true });
    return { ok: true, restored: true, asarPath };
  } catch (error) {
    try {
      if (dfs.existsSync(asarPath) && !dfs.existsSync(asarBackup)) dfs.renameSync(asarPath, asarBackup);
      if (!dfs.existsSync(appDir) && dfs.existsSync(quarantine)) dfs.renameSync(quarantine, appDir);
    } catch { /* preserve the original failure */ }
    return { ok: false, reason: "restore-failed", message: error.message, asarPath, asarBackup };
  }
}

export function packAsarArchive(srcDir, outAsarPath) {
  const dfs = diskFs();
  const payloads = [];
  let offset = 0;

  function buildTree(dir) {
    const files = {};
    for (const ent of dfs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        files[ent.name] = buildTree(full);
      } else if (ent.isFile()) {
        const buf = dfs.readFileSync(full);
        files[ent.name] = { size: buf.length, offset: String(offset) };
        payloads.push(buf);
        offset += buf.length;
      }
    }
    return { files };
  }

  const tree = buildTree(srcDir);
  const jsonBuf = Buffer.from(JSON.stringify(tree), "utf8");
  const alignedJsonLen = (jsonBuf.length + 3) & ~3;
  const headerStringSize = 4 + alignedJsonLen;
  const headerSize = 4 + headerStringSize;
  const headerBuf = Buffer.alloc(8 + headerSize);
  headerBuf.writeUInt32LE(4, 0);
  headerBuf.writeUInt32LE(headerSize, 4);
  headerBuf.writeUInt32LE(headerStringSize, 8);
  headerBuf.writeUInt32LE(jsonBuf.length, 12);
  jsonBuf.copy(headerBuf, 16);

  dfs.mkdirSync(path.dirname(outAsarPath), { recursive: true });
  dfs.writeFileSync(outAsarPath, Buffer.concat([headerBuf, ...payloads]));
  headerCache.delete(outAsarPath);
  return outAsarPath;
}
