import fs from "node:fs";
import path from "node:path";
import { logsDir, ensureDir } from "./paths.mjs";

let sink = null;

export function setLogFile(file) {
  sink = file;
  if (file) ensureDir(path.dirname(file));
}

function write(line) {
  if (!sink) return;
  fs.appendFileSync(sink, line + "\n");
}

export function log(event, detail = {}, level = "info") {
  const entry = { ts: new Date().toISOString(), level, event, ...detail };
  if (process.env.DSH_FORGE_DEBUG === "1") {
    console.error(`[dsh-forge] ${event}`, detail);
  }
  write(JSON.stringify(entry));
}

export function defaultLogFile(env = {}) {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return path.join(logsDir(env), `forge-${day}.jsonl`);
}

export function readLog(limit = 50, env = {}) {
  const file = defaultLogFile(env);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  return lines.slice(-limit).map((line) => {
    try { return JSON.parse(line); } catch { return { raw: line }; }
  });
}

export function clearLogs(env = {}) {
  const dir = logsDir(env);
  if (!fs.existsSync(dir)) return { removed: 0 };
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith(".jsonl") || name.endsWith(".log")) {
      fs.unlinkSync(path.join(dir, name));
      removed += 1;
    }
  }
  return { removed };
}
