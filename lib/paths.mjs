import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { diskFs, readHostFileFromAsar } from "./asar.mjs";

const PKG_PATH = path.join(import.meta.dirname, "..", "package.json");
const PKG = JSON.parse(fs.readFileSync(PKG_PATH, "utf8"));

export const VERSION = PKG.version || "0.1.0";

export function expandHome(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function displayPath(p) {
  const home = os.homedir();
  const encodedHome = home.replace(/^\//, "").replace(/ /g, "~0020").replace(/\//g, "-");
  let text = String(p ?? "");
  if (text === home) return "~";
  if (text.startsWith(home + path.sep)) text = "~" + text.slice(home.length);
  if (encodedHome) text = text.split(`--${encodedHome}-`).join("--~-");
  return text;
}

export function redactText(value) {
  const home = os.homedir();
  const encodedHome = home.replace(/^\//, "").replace(/ /g, "~0020").replace(/\//g, "-");
  let out = String(value ?? "").split(home).join("~");
  if (encodedHome) out = out.split(`--${encodedHome}-`).join("--~-");
  return out
    .replace(/\/Users\/[^\/\s"']+/g, "/Users/<user>")
    .replace(/\/home\/[^\/\s"']+/g, "/home/<user>")
    .replace(/[A-Za-z]:\\+Users\\+[^\\\s"']+/g, "C:\\Users\\<user>")
    .replace(/--Users-[A-Za-z0-9._-]+-/g, "--Users-<user>-")
    .replace(/--home-[A-Za-z0-9._-]+-/g, "--home-<user>-");
}

export function dshHome(env = {}) {
  return expandHome(env.dshHome || process.env.DSH_HOME || "~/.dsh");
}

export function profileName(env = {}) {
  return env.profile || process.env.DSH_FORGE_PROFILE || "desktop";
}

export function profileDir(env = {}) {
  return path.join(dshHome(env), "profiles", profileName(env));
}

const HOST_CANDIDATES = process.platform === "win32"
  ? [
      path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Programs", "DeepSeek Harness", "resources", "app", "dsh"),
      path.join(process.env.ProgramFiles || "C:\\Program Files", "DeepSeek Harness", "resources", "app", "dsh"),
    ]
  : [
      "/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh",
      "/opt/DeepSeek Harness/resources/app/dsh",
      "/usr/lib/deepseek-harness/resources/app/dsh",
    ];

export function hostRoot(env = {}) {
  if (env.hostRoot) return expandHome(env.hostRoot);
  if (process.env.DSH_FORGE_HOST_ROOT) return expandHome(process.env.DSH_FORGE_HOST_ROOT);
  const dfs = diskFs();
  for (const candidate of HOST_CANDIDATES) {
    if (dfs.existsSync(path.join(candidate, "node_modules", "@deepseek-ai"))) return candidate;
    if (dfs.existsSync(path.resolve(candidate, "..", "..", "app.asar"))) return candidate;
  }
  return HOST_CANDIDATES[0];
}

export function forgeDir(env = {}) {
  return path.join(dshHome(env), "dsh-forge");
}

export function backupsDir(env = {}) {
  return path.join(forgeDir(env), "backups");
}

export function reportsDir(env = {}) {
  return path.join(forgeDir(env), "reports");
}

export function logsDir(env = {}) {
  return path.join(forgeDir(env), "logs");
}

export function promptInjectPath(env = {}) {
  return path.join(dshHome(env), "prompt-inject.md");
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureNotSymlink(file, dfs = fs) {
  try {
    if (dfs.lstatSync(file).isSymbolicLink()) {
      throw new Error(`refusing to write through symlink: ${file}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export function writeFileAtomic(file, data, { mode = null, dfs = fs } = {}) {
  ensureNotSymlink(file, dfs);
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
  dfs.writeFileSync(tmp, data);
  if (mode !== null) dfs.chmodSync(tmp, mode);
  dfs.renameSync(tmp, file);
}

export function targetPath(file, env = {}) {
  const raw = String(file || "");
  if (raw.startsWith("~/") || path.isAbsolute(raw) || raw.split(/[\\/]+/).includes("..")) {
    throw new Error(`unsafe patch path: ${raw}`);
  }
  const root = raw.startsWith("profiles/") || raw.startsWith(".agent-presets/")
    ? dshHome(env)
    : hostRoot(env);
  const abs = path.resolve(root, raw);
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error(`path escapes root: ${raw}`);
  return abs;
}

export function hostVersion(root = hostRoot()) {
  try {
    const dfs = diskFs();
    const pkgPath = path.join(root, "package.json");
    const raw = dfs.existsSync(pkgPath)
      ? dfs.readFileSync(pkgPath, "utf8")
      : readHostFileFromAsar(root, "package.json", "utf8");
    if (!raw) return "unknown";
    const pkg = JSON.parse(raw);
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}
