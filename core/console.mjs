import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fail } from "./errors.mjs";

export const CONSOLE_HOST = "127.0.0.1";
export const CONSOLE_PORT = 7788;
export const CONSOLE_ROUTES = ["/", "/patches", "/channels", "/grades", "/personas", "/api/state"];

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/**
 * One console per state directory. A stale pid file (process gone) is replaced;
 * a live one blocks the second instance instead of letting two servers fight
 * over the same port.
 */
export function acquireLock(dir, { pid = process.pid } = {}) {
  const file = path.join(dir, "console.pid");
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(file)) {
    const held = Number(fs.readFileSync(file, "utf8").trim());
    if (Number.isInteger(held) && held > 0 && held !== pid && alive(held)) {
      fail("console-lock", `console already running with pid ${held}`, { file, pid: held });
    }
  }
  fs.writeFileSync(file, `${pid}\n`);
  return {
    file,
    pid,
    release() {
      try {
        if (Number(fs.readFileSync(file, "utf8").trim()) === pid) fs.unlinkSync(file);
      } catch {
        /* the lock is advisory; a missing file means someone already released it */
      }
    },
  };
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function layout(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>dsh-forge · ${escapeHtml(title)}</title>
<style>body{font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;margin:2rem;color:#111}table{border-collapse:collapse;margin:1rem 0}td,th{border:1px solid #ccc;padding:.25rem .6rem;text-align:left}th{background:#f4f4f4}.ok{color:#0a7}.warn{color:#b60}.fail{color:#b00}nav a{margin-right:1rem}</style>
</head><body>
<nav><a href="/">overview</a><a href="/patches">patches</a><a href="/channels">channels</a><a href="/grades">grades</a><a href="/personas">personas</a><a href="/api/state">api</a></nav>
<h1>${escapeHtml(title)}</h1>
${body}
</body></html>
`;
}

function table(columns, rows) {
  const head = `<tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
  return `<table>${head}${body}</table>`;
}

export function renderOverview(state = {}) {
  const checks = state.doctor?.checks || [];
  const failing = checks.filter((c) => c.status !== "ok").length;
  const parts = [
    `<p>host <strong>${escapeHtml(state.host?.version || "unknown")}</strong> · patches <strong>${escapeHtml(state.patches?.ready ?? "?")}/${escapeHtml(state.patches?.total ?? "?")}</strong> ready · checks <strong>${checks.length - failing}</strong> ok / <strong>${failing}</strong> else</p>`,
  ];
  if (checks.length) parts.push(table(["check", "status", "detail"], checks.map((c) => [c.label || c.id, c.status, c.detail || ""])));
  const activation = state.doctor?.activation;
  if (activation) parts.push(`<p>activation <strong>${escapeHtml(activation.state)}</strong>${activation.requiresRestart ? " · restart required" : ""}</p>`);
  return layout("overview", parts.join("\n"));
}

export function renderPatches(state = {}) {
  const rows = (state.patches?.rows || []).map((row) => [row.id, row.layer || "-", row.status || "-", row.hits ?? "-"]);
  return layout("patches", table(["patch", "layer", "status", "hits"], rows));
}

export function renderChannels(state = {}) {
  const rows = (state.profiles || []).map((row) => [row.id, row.support, row.channels?.project ?? 0, row.channels?.install ?? 0, row.channels?.slash ?? 0, row.channels?.none ?? 0]);
  return layout("channels", table(["profile", "track", "project", "install", "slash", "none"], rows));
}

export function renderGrades(state = {}) {
  const rows = (state.profiles || []).map((row) => [row.id, row.delivery?.grade || "unobservable", row.delivery?.source || "none", row.delivery?.mechanism || ""]);
  return layout("grades", table(["profile", "grade", "source", "mechanism"], rows));
}

export function renderPersonas(state = {}) {
  const rows = (state.personas || []).map((row) => [row.id, row.mode, row.harness, row.chars]);
  return layout("personas", table(["persona", "mode", "harness", "chars"], rows));
}

const RENDERERS = {
  "/": renderOverview,
  "/patches": renderPatches,
  "/channels": renderChannels,
  "/grades": renderGrades,
  "/personas": renderPersonas,
};

/**
 * Read-only HTTP surface. `state` is a function so every request sees current
 * host facts instead of a snapshot taken at boot.
 */
export function createConsole({ state = () => ({}), host = CONSOLE_HOST, port = CONSOLE_PORT } = {}) {
  return http.createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain" });
      res.end("read-only console\n");
      return;
    }
    if (!CONSOLE_ROUTES.includes(url)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found\n");
      return;
    }
    let payload;
    try {
      payload = state();
    } catch (error) {
      payload = { error: error?.message || String(error) };
    }
    if (url === "/api/state") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(RENDERERS[url](payload));
  });
}
