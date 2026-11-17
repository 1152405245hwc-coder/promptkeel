import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fail } from "./errors.mjs";

export const CONSOLE_HOST = "127.0.0.1";
export const CONSOLE_PORT = 7788;
export const CONSOLE_ROUTES = ["/", "/patches", "/channels", "/grades", "/personas", "/audit", "/api/state"];

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

const NAV = [
  ["/", "overview"],
  ["/patches", "patches"],
  ["/channels", "channels"],
  ["/grades", "grades"],
  ["/personas", "personas"],
  ["/audit", "audit"],
  ["/api/state", "api"],
];

const CSS = `
:root{--bg:#0b0e13;--panel:#141b24;--panel2:#18212c;--line:#232d3a;--text:#e7eef6;--dim:#8a97a6;--mute:#5d6a79;--amber:#f0b35b;--green:#5fd39b;--red:#ef6b73;--blue:#6cb6ff;--radius:12px}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(1200px 620px at 18% -12%,#16202b 0,#0b0e13 58%);color:var(--text);font:14px/1.6 "SF Pro Text","PingFang SC",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:13px 24px;border-bottom:1px solid var(--line);background:rgba(11,14,19,.84);backdrop-filter:blur(12px)}
.brand{display:flex;align-items:center;gap:9px;font:700 12.5px/1 "SF Mono",ui-monospace,monospace;letter-spacing:.18em;color:var(--amber)}
.mark{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;font-size:11px;color:#1a1206;background:linear-gradient(145deg,rgba(240,179,91,.95),rgba(240,179,91,.3));box-shadow:inset 0 0 0 1px rgba(240,179,91,.4)}
.nav{display:flex;gap:2px;flex-wrap:wrap}
.nav a{padding:6px 11px;border-radius:8px;color:var(--dim);font-size:12.5px;transition:background .15s ease,color .15s ease}
.nav a:hover{color:var(--text);background:#182130}
.nav a[aria-current]{color:#171006;background:var(--amber);font-weight:650}
.spacer{flex:1}
.wrap{max-width:1080px;margin:0 auto;padding:26px 24px 40px}
.hero{margin-bottom:20px}
.hero h1{margin:0 0 4px;font-size:21px;letter-spacing:-.01em}
.hero p{margin:0;color:var(--dim);font-size:12.5px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(184px,1fr));gap:11px;margin-bottom:20px}
.card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:var(--radius);padding:13px 15px}
.card .k{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--mute);margin-bottom:7px}
.card .v{font:650 21px/1.15 "SF Mono",ui-monospace,monospace;letter-spacing:-.02em}
.card .hint{margin-top:5px;font-size:11.5px;color:var(--dim)}
.bar{margin-top:9px;height:5px;border-radius:999px;background:#1d2632;overflow:hidden}
.bar span{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--green),#8ee0ba)}
.bar.warn span{background:linear-gradient(90deg,var(--amber),#f6d09a)}
.sec{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);margin-bottom:16px;overflow:hidden}
.sec>h2{margin:0;padding:11px 15px;font-size:11.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);background:var(--panel2);border-bottom:1px solid var(--line)}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--mute);padding:9px 15px;border-bottom:1px solid var(--line);font-weight:600;white-space:nowrap}
td{padding:9px 15px;border-bottom:1px solid rgba(35,45,58,.6);vertical-align:middle}
tbody tr:nth-child(even){background:rgba(24,33,44,.42)}
tbody tr:hover{background:rgba(240,179,91,.05)}
tbody tr:last-child td{border-bottom:0}
.mono{font-family:"SF Mono",ui-monospace,monospace;font-size:12.5px}
.chip{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;letter-spacing:.02em;border:1px solid var(--line);color:var(--dim);background:rgba(255,255,255,.02)}
.chip.ok{color:var(--green);border-color:rgba(95,211,155,.34);background:rgba(95,211,155,.08)}
.chip.warn{color:var(--amber);border-color:rgba(240,179,91,.34);background:rgba(240,179,91,.08)}
.chip.bad{color:var(--red);border-color:rgba(239,107,115,.34);background:rgba(239,107,115,.08)}
.kv{display:grid;grid-template-columns:180px 1fr;gap:0}
.kv div{padding:9px 15px;border-bottom:1px solid rgba(35,45,58,.6)}
.kv div:nth-child(odd){color:var(--dim)}
.kv div:nth-last-child(-n+2){border-bottom:0}
.personas{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:11px;padding:15px}
.persona{border:1px solid var(--line);border-radius:10px;padding:13px 15px;background:var(--panel2)}
.persona b{font:650 13px/1.4 "SF Mono",ui-monospace,monospace;color:var(--amber)}
.persona p{margin:7px 0 0;color:var(--dim);font-size:12px}
.empty{padding:30px;text-align:center;color:var(--mute)}
footer{padding:18px 24px 30px;text-align:center;color:var(--mute);font-size:11.5px}
@media (max-width:640px){.wrap{padding:18px 14px 30px}.kv{grid-template-columns:1fr}.kv div{padding:6px 14px}.kv div:nth-child(odd){border-bottom:0;font-size:11px;text-transform:uppercase;letter-spacing:.08em}}
@media print{body{background:#fff;color:#111}.top,.nav,footer{display:none}.sec,.card{border-color:#ddd;background:#fff}}
`;

function chip(text, tone) {
  return `<span class="chip${tone ? ` ${tone}` : ""}">${escapeHtml(text)}</span>`;
}

function toneOf(value) {
  const s = String(value ?? "").toLowerCase();
  if (["ok", "ready", "hit", "applied", "pass", "replace-full"].includes(s)) return "ok";
  if (["warn", "partial", "research", "append-only", "configured"].includes(s)) return "warn";
  if (["fail", "miss", "missing", "ambiguous", "unobservable", "error", "shim-only"].includes(s)) return "bad";
  return "";
}

function layout(title, body, { route = "/", subtitle = "" } = {}) {
  const links = NAV.map(([href, label]) => `<a href="${href}"${href === route ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>dsh-forge · ${escapeHtml(title)}</title>
<style>${CSS}</style></head>
<body>
<header class="top">
<div class="brand"><span class="mark">F</span>DSH FORGE</div>
<nav class="nav">${links}</nav>
<div class="spacer"></div>
${chip("read-only")}
${chip("127.0.0.1")}
</header>
<main class="wrap">
<div class="hero"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle || "local host facts, read straight from the same doctor the CLI uses")}</p></div>
${body}
</main>
<footer>dsh-forge console · GET only · state recomputed per request</footer>
</body></html>
`;
}

function card(label, value, hint = "", { bar = null, warn = false } = {}) {
  const meter = bar ? `<div class="bar${warn ? " warn" : ""}"><span style="width:${bar}%"></span></div>` : "";
  const note = hint ? `<div class="hint">${escapeHtml(hint)}</div>` : "";
  return `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div>${note}${meter}</div>`;
}

function table(columns, rows) {
  const head = `<tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
  const body = rows
    .map((row) => `<tr>${row.map((cell) => {
      const c = cell && typeof cell === "object" ? cell : { v: cell };
      const text = c.mono ? `<span class="mono">${escapeHtml(c.v)}</span>` : escapeHtml(c.v ?? "");
      return `<td>${c.tone === false ? text : c.chip ? chip(c.v ?? "", c.tone) : text}</td>`;
    }).join("")}</tr>`)
    .join("");
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function section(title, inner) {
  return `<section class="sec"><h2>${escapeHtml(title)}</h2>${inner}</section>`;
}

export function renderOverview(state = {}) {
  const checks = state.doctor?.checks || [];
  const failing = checks.filter((c) => c.status !== "ok").length;
  const ready = Number(state.patches?.ready ?? 0);
  const total = Number(state.patches?.total ?? 0);
  const pct = total ? Math.round((ready / total) * 100) : 0;
  const activation = state.doctor?.activation;
  const cards = [
    card("host", state.host?.version || "unknown", state.host?.root ? "root resolved" : "root unknown"),
    card("patches ready", `${ready}/${total}`, pct === 100 ? "all layers armed" : "anchor drift present", { bar: pct, warn: pct < 100 }),
    card("checks", `${checks.length - failing}/${checks.length}`, failing ? `${failing} need attention` : "no drift"),
    card("activation", activation?.state || "unknown", activation?.requiresRestart ? "restart required" : "no restart pending"),
  ];
  const parts = [`<div class="grid">${cards.join("")}</div>`];
  if (checks.length) {
    parts.push(section("checks", table(["check", "status", "detail"], checks.map((c) => [c.label || c.id, { v: c.status, chip: true, tone: toneOf(c.status) }, { v: c.detail || "", mono: true }]))));
  }
  if (activation) {
    parts.push(section("activation evidence", `<div class="kv">
<div>state</div><div>${chip(activation.state, toneOf(activation.state))}</div>
<div>restart required</div><div>${chip(activation.requiresRestart ? "yes" : "no", activation.requiresRestart ? "warn" : "ok")}</div>
</div>`));
  }
  return layout("overview", parts.join("\n"), { route: "/", subtitle: `${state.host?.version || "host"} · ${state.patches?.rows?.length || total} patches · ${state.profiles?.length || 0} profiles` });
}

export function renderPatches(state = {}) {
  const rows = state.patches?.rows || [];
  const ready = rows.filter((r) => toneOf(r.status) === "ok").length;
  const layers = [...new Set(rows.map((r) => r.layer).filter(Boolean))];
  const body = rows.length
    ? table(["patch", "layer", "status", "hits"], rows.map((row) => [
      { v: row.id, mono: true },
      { v: row.layer || "-", chip: true },
      { v: row.status || "-", chip: true, tone: toneOf(row.status) },
      { v: row.hits ?? row.matches ?? "-", mono: true },
    ]))
    : `<div class="empty">no patch rows</div>`;
  return layout("patches", [
    `<div class="grid">${[
      card("ready", `${ready}/${rows.length}`, "hit, applied or ready"),
      card("layers", String(layers.length), layers.join(" · ")),
    ].join("")}</div>`,
    section("patch table", body),
  ].join("\n"), { route: "/patches", subtitle: "declarative find/replace entries, one marker each" });
}

export function renderChannels(state = {}) {
  const rows = (state.profiles || []).map((row) => [
    { v: row.id, mono: true },
    { v: row.support, chip: true },
    { v: row.channels?.project ?? 0, mono: true },
    { v: row.channels?.install ?? 0, mono: true },
    { v: row.channels?.shim ?? 0, mono: true },
    { v: row.channels?.slash ?? 0, mono: true },
    { v: row.channels?.none ?? 0, mono: true },
  ]);
  return layout("channels", section("delivery channels", table(["profile", "track", "project", "install", "shim", "slash", "none"], rows)), { route: "/channels", subtitle: "where each action lands and when it takes effect" });
}

export function renderGrades(state = {}) {
  const rows = (state.profiles || []).map((row) => [
    { v: row.id, mono: true },
    { v: row.delivery?.grade || "unobservable", chip: true, tone: toneOf(row.delivery?.grade) },
    { v: row.delivery?.source || "none", mono: true },
    { v: row.delivery?.mechanism || "", mono: true },
  ]);
  return layout("grades", section("per-host delivery grade", table(["profile", "grade", "source", "mechanism"], rows)), { route: "/grades", subtitle: "replace-full → append-only → unobservable, with the evidence behind each row" });
}

export function renderPersonas(state = {}) {
  const rows = state.personas || [];
  const cards = rows.map((row) => `<div class="persona"><b>${escapeHtml(row.id)}</b> ${chip(row.mode || "-")} <p>${escapeHtml(row.harness || "any")} · ${escapeHtml(row.chars ?? 0)} chars</p></div>`).join("");
  return layout("personas", rows.length ? `<section class="sec"><h2>persona library</h2><div class="personas">${cards}</div></section>` : `<div class="empty">no personas found</div>`, { route: "/personas", subtitle: "markdown personas with a default composition mode" });
}

export function renderAudit(state = {}) {
  const counts = Object.entries(state.audit?.counts || {}).sort((a, b) => b[1] - a[1]);
  const snapshots = (state.snapshots?.rows || []).map((row) => [{ v: row.at, mono: true }, { v: row.label, chip: true }, { v: row.bytes, mono: true }, { v: row.name, mono: true }]);
  const limits = state.snapshots?.limits || {};
  return layout("audit", [
    `<div class="grid">${[
      card("events", String(state.audit?.total ?? 0), "parsed from the forge log"),
      card("snapshots", String(snapshots.length), `keep ${limits.keep ?? "?"} · days ${limits.days ?? "?"}`),
    ].join("")}</div>`,
    section("events by kind", counts.length ? table(["event", "count"], counts.map(([event, n]) => [{ v: event, mono: true }, { v: n, mono: true }])) : `<div class="empty">no events yet</div>`),
    section("prompt snapshots", snapshots.length ? table(["taken at", "label", "bytes", "file"], snapshots) : `<div class="empty">no snapshots yet</div>`),
  ].join("\n"), { route: "/audit", subtitle: "append-only history and the last N prompt snapshots" });
}

const RENDERERS = {
  "/": renderOverview,
  "/patches": renderPatches,
  "/channels": renderChannels,
  "/grades": renderGrades,
  "/personas": renderPersonas,
  "/audit": renderAudit,
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
