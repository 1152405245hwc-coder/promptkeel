import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { fail } from "./errors.mjs";
import { CONSOLE_CSS, escapeHtml } from "../ui/tokens.mjs";
import { listProfiles, listModels, loadProfile, loadModel } from "./contract.mjs";
import { compile, normalizeContext } from "./compile.mjs";
import { applyPlan, previewPlan, revertPlan, verifyPlan, listPlans, defaultStateRoot } from "./executor.mjs";
import { listPersonas } from "./persona.mjs";
import { TRANSFORMS } from "./transform.mjs";
import { runProbes, selfCheck, PROBES } from "./probe.mjs";
import { STRATEGIES, resolveStrategy } from "./strategy.mjs";
import {
  resolveGateway,
  fetchModelIds,
  executeStrategyRequest,
  detectRefusal,
  verdictOf,
  complianceOf,
  assertGatewayUrl,
  DEFAULT_MAX_TOKENS,
} from "./gateway.mjs";
import { writeSnapshot, pruneSnapshots, SNAPSHOT_DEFAULTS } from "./snapshot.mjs";

export { escapeHtml };

export const CONSOLE_HOST = "127.0.0.1";
export const CONSOLE_PORT = 7788;
export const CONSOLE_ROUTES = [
  "/",
  "/workbench",
  "/plans",
  "/live",
  "/patches",
  "/channels",
  "/grades",
  "/personas",
  "/audit",
  "/api/state",
];

const WORKBENCH_JS_PATH = path.resolve(import.meta.dirname, "..", "ui", "workbench.js");
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const CSP_HEADER = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'";

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/** One console per state directory. Stale pid files are replaced; live locks block. */
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
        /* advisory lock already released */
      }
    },
  };
}

const NAV = [
  ["/", "overview"],
  ["/workbench", "workbench"],
  ["/plans", "plans"],
  ["/live", "live"],
  ["/patches", "patches"],
  ["/channels", "channels"],
  ["/grades", "grades"],
  ["/personas", "personas"],
  ["/audit", "audit"],
  ["/api/state", "api"],
];

function chip(text, tone) {
  return `<span class="chip${tone ? ` ${tone}` : ""}">${escapeHtml(text)}</span>`;
}

function toneOf(value) {
  const s = String(value ?? "").toLowerCase();
  if (["ok", "ready", "hit", "applied", "pass", "replace-full", "delivered"].includes(s)) return "ok";
  if (["warn", "partial", "research", "append-only", "configured", "verified-config", "reverted"].includes(s)) return "warn";
  if (["fail", "miss", "missing", "ambiguous", "unobservable", "error", "shim-only", "blocked", "withheld"].includes(s)) return "bad";
  return "";
}

function layout(title, body, { route = "/", subtitle = "", modeLabel = "workbench" } = {}) {
  const links = NAV.map(([href, label]) => `<a href="${href}"${href === route ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>dsh-forge · ${escapeHtml(title)}</title>
<style>${CONSOLE_CSS}</style></head>
<body>
<header class="top">
<div class="brand"><span class="mark">F</span>DSH FORGE</div>
<nav class="nav">${links}</nav>
<div class="spacer"></div>
${chip(modeLabel)}
${chip("127.0.0.1")}
</header>
<main class="wrap">
<div class="hero"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle || "local host facts and prompt compiler")}</p></div></div>
${body}
</main>
<footer>dsh-forge workbench · loopback 127.0.0.1 · state recomputed per request</footer>
</body></html>
`;
}

function card(label, value, hint = "", { bar = null, warn = false } = {}) {
  const meter = bar !== null && bar !== undefined ? `<div class="bar${warn ? " warn" : ""}"><span style="width:${bar}%"></span></div>` : "";
  const note = hint ? `<div class="hint">${escapeHtml(hint)}</div>` : "";
  return `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div>${note}${meter}</div>`;
}

function table(columns, rows, rowAttrs = null) {
  const head = `<tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
  const body = rows
    .map((row, index) => {
      const attr = rowAttrs ? rowAttrs(row, index) : "";
      const cells = row.map((cell) => {
        if (cell && typeof cell === "object" && cell.rawHtml !== undefined) return `<td>${cell.rawHtml}</td>`;
        const c = cell && typeof cell === "object" ? cell : { v: cell };
        const text = c.mono ? `<span class="mono">${escapeHtml(c.v)}</span>` : escapeHtml(c.v ?? "");
        return `<td>${c.tone === false ? text : c.chip ? chip(c.v ?? "", c.tone) : text}</td>`;
      }).join("");
      return `<tr${attr ? ` ${attr}` : ""}>${cells}</tr>`;
    })
    .join("");
  return `<div class="scroll"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function section(title, inner, rightHtml = "") {
  return `<section class="sec"><h2><span>${escapeHtml(title)}</span>${rightHtml}</h2>${inner}</section>`;
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
  return layout("overview", parts.join("\n"), {
    route: "/",
    subtitle: `${state.host?.version || "host"} · ${state.patches?.rows?.length || total} patches · ${state.profiles?.length || 0} profiles`,
    modeLabel: "read-only overview",
  });
}

export function renderWorkbench(state = {}) {
  const profiles = (state.profiles?.length ? state.profiles : listProfiles()).map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.id)} (${escapeHtml(p.host)})</option>`).join("");
  const models = (state.models?.length ? state.models : listModels()).map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.id)}</option>`).join("");
  const personas = [`<option value="">(none)</option>`, ...(state.personas?.length ? state.personas : listPersonas()).map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.id)} (${escapeHtml(p.mode)})</option>`)].join("");
  const personaModes = ["", "replace", "strict", "append", "off"].map((m) => `<option value="${m}">${m || "(default)"}</option>`).join("");
  const transforms = TRANSFORMS.map((t) => `<option value="${t}">${t}</option>`).join("");
  const strategies = STRATEGIES.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.id)} · ${escapeHtml(s.label)}</option>`).join("");
  const modes = ["", "coding", "chat", "review"].map((m) => `<option value="${m}">${m || "(auto)"}</option>`).join("");

  const controls = `<div class="pad" id="forge-workbench-root">
<div class="form-grid">
  <label class="field">Profile<select id="wb-profile">${profiles}</select></label>
  <label class="field">Model<select id="wb-model">${models}</select></label>
  <label class="field">Persona<select id="wb-persona">${personas}</select></label>
  <label class="field">Persona Mode<select id="wb-persona-mode">${personaModes}</select></label>
  <label class="field">Transform<select id="wb-transform">${transforms}</select></label>
  <label class="field">Strategy<select id="wb-strategy">${strategies}</select></label>
  <label class="field">Task Mode<select id="wb-mode">${modes}</select></label>
</div>
<div class="btn-row" style="margin-top:12px">
  <button type="button" class="btn primary" id="wb-compile-btn">Compile Plan</button>
  <button type="button" class="btn" id="wb-probe-btn">Run Static Probe (${PROBES.length})</button>
  <button type="button" class="btn ok" id="wb-apply-btn">Preview &amp; Apply Plan</button>
  <button type="button" class="btn" id="wb-snapshot-btn">Save Snapshot</button>
</div>
<div class="hint mono" id="wb-meta" style="margin-top:10px;color:var(--dim)">Select a profile and compile.</div>
<div class="hint mono" id="wb-probe-out" style="margin-top:4px;color:var(--green)"></div>
</div>`;

  const actionSec = section("compiled target actions", `<div class="scroll"><table><thead><tr><th>op</th><th>kind</th><th>target path</th></tr></thead><tbody id="wb-actions"></tbody></table></div>`);
  const promptSec = section("compiled prompt", `<pre class="codebox" id="wb-prompt-out"></pre>`);
  return layout("workbench", [section("prompt & plan compiler", controls), actionSec, promptSec].join("\n"), {
    route: "/workbench",
    subtitle: "compile profiles, run static armour probes, save snapshots, and apply reversible workspace plans",
  });
}

export function renderPlans(state = {}) {
  const plans = state.plans || [];
  const body = plans.length
    ? table(["plan id", "profile", "host", "status", "files", "actions"], plans.map((row) => [
      { v: row.id, mono: true },
      { v: row.profile || "-", mono: true },
      { v: row.host || "-", mono: true },
      { v: row.status || (row.invalid ? "invalid" : "-"), chip: true, tone: toneOf(row.status || "error") },
      { v: row.files ?? 0, mono: true },
      {
        rawHtml: `<div class="btn-row"><button type="button" class="btn" data-plan-verify="${escapeHtml(row.id)}">Verify</button>${row.status === "applied" ? `<button type="button" class="btn danger" data-plan-revert="${escapeHtml(row.id)}">Revert</button>` : ""}</div>`,
      },
    ]))
    : `<div class="empty">no plans applied in this state directory yet</div>`;
  return layout("plans", section("applied plan manifests", body), {
    route: "/plans",
    subtitle: "verify post-apply hashes and revert any workspace plan byte-for-byte",
  });
}

export function renderLive(state = {}) {
  const profiles = (state.profiles?.length ? state.profiles : listProfiles()).map((p) => `<option value="${escapeHtml(p.id)}"${p.id === "generic" ? " selected" : ""}>${escapeHtml(p.id)}</option>`).join("");
  const personas = [`<option value="">(none)</option>`, ...(state.personas?.length ? state.personas : listPersonas()).map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.id)}</option>`)].join("");
  const strategies = STRATEGIES.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.id)} · ${escapeHtml(s.label)}</option>`).join("");
  const capabilityProbe = PROBES.find((p) => p.severity === "capability");
  const defaultPrompt = capabilityProbe?.request || "Outline a deterministic config serializer in Python.";

  const controls = `<div class="pad" id="forge-live-root">
<div class="form-grid">
  <label class="field">Gateway URL<input id="live-gateway" value="http://127.0.0.1:3425/v1" placeholder="default or http://127.0.0.1:3425/v1"></label>
  <label class="field">Model<select id="live-model"><option value="glm-5.3-flash">glm-5.3-flash</option><option value="glm-5.3">glm-5.3</option><option value="commandcode/deepseek/deepseek-v4.1-flash">commandcode/deepseek/deepseek-v4.1-flash</option><option value="group/free-strong">group/free-strong</option></select></label>
  <label class="field">Profile<select id="live-profile">${profiles}</select></label>
  <label class="field">Persona<select id="live-persona">${personas}</select></label>
  <label class="field">Strategy<select id="live-strategy">${strategies}</select></label>
  <label class="field">Max Tokens<input id="live-max-tokens" type="number" value="512" min="64" max="4096"></label>
</div>
<label class="field" style="margin-top:12px">User Prompt<textarea id="live-prompt">${escapeHtml(defaultPrompt)}</textarea></label>
<div class="btn-row" style="margin-top:10px">
  <button type="button" class="btn" id="live-fetch-models">Fetch Gateway Models</button>
  <button type="button" class="btn primary" id="live-send-btn">Send Bounded Request</button>
  <span class="mono" id="live-status" style="font-size:12px;color:var(--dim)">ready · Magpie loopback :3425</span>
</div>
</div>`;
  const replySec = section("model response & refusal classification", `<pre class="codebox" id="live-reply">(no response yet)</pre>`);
  return layout("live runner", [section("gateway & strategy harness", controls), replySec].join("\n"), {
    route: "/live",
    subtitle: "test composed prompts and escalation strategies directly against Magpie :3425 or compatible APIs",
  });
}

export function renderPatches(state = {}, { interactiveDsh = false } = {}) {
  const rows = state.patches?.rows || [];
  const ready = rows.filter((r) => toneOf(r.status) === "ok").length;
  const layers = [...new Set(rows.map((r) => r.layer).filter(Boolean))];
  const body = rows.length
    ? table(["patch", "layer", "status", "hits"], rows.map((row) => [
      { v: row.id, mono: true },
      { v: row.layer || "-", chip: true },
      { v: row.status || "-", chip: true, tone: toneOf(row.status) },
      { v: row.hits ?? row.matches ?? "-", mono: true },
    ]), (row) => `data-layer="${escapeHtml(row[1].v)}"`)
    : `<div class="empty">no patch rows</div>`;
  const filterRight = `<div class="btn-row"><select id="patch-layer-filter" aria-label="Filter by layer"><option value="all">all layers</option>${layers.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("")}</select>${interactiveDsh ? `<button type="button" class="btn" id="dsh-dry-run">Dry Run</button><button type="button" class="btn primary" id="dsh-apply">Apply</button><button type="button" class="btn" id="dsh-upgrade">Upgrade</button><button type="button" class="btn danger" id="dsh-revert">Revert</button>` : ""}</div>`;
  return layout("patches", [
    `<div class="grid">${[
      card("ready", `${ready}/${rows.length}`, "hit, applied or ready"),
      card("layers", String(layers.length), layers.join(" · ")),
    ].join("")}</div>`,
    section("patch table", body, filterRight),
  ].join("\n"), { route: "/patches", subtitle: "declarative find/replace entries across 5 runtime layers" });
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
  return layout("grades", section("per-host delivery grade", table(["profile", "grade", "source", "mechanism"], rows)), { route: "/grades", subtitle: "replace-full → append-only → unobservable, verified dynamically from compiled actions" });
}

export function renderPersonas(state = {}) {
  const rows = state.personas || [];
  const cards = rows.map((row) => `<div class="persona"><b>${escapeHtml(row.id)}</b> ${chip(row.mode || "-")} <p>${escapeHtml(row.harness || "any")} · ${escapeHtml(row.chars ?? 0)} chars</p></div>`).join("");
  return layout("personas", rows.length ? `<section class="sec"><h2>persona library</h2><div class="personas">${cards}</div></section>` : `<div class="empty">no personas found</div>`, { route: "/personas", subtitle: "markdown personas with default composition mode and optional transforms" });
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
  ].join("\n"), { route: "/audit", subtitle: "append-only history and recent prompt snapshots" });
}

const RENDERERS = {
  "/": renderOverview,
  "/workbench": renderWorkbench,
  "/plans": renderPlans,
  "/live": renderLive,
  "/patches": renderPatches,
  "/channels": renderChannels,
  "/grades": renderGrades,
  "/personas": renderPersonas,
  "/audit": renderAudit,
};

function hostnameOf(authority) {
  if (!authority || /[/?#@\\]/.test(authority)) return "";
  try {
    const u = new URL(`http://${authority}`);
    if (u.username || u.password || u.pathname !== "/" || u.search || u.hash) return "";
    return u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return "";
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(`${JSON.stringify(data, null, 2)}\n`);
}

function allowConsoleRequest(req, res, { requireCsrf = false, csrfToken = "" } = {}) {
  const authority = String(req.headers.host || "").trim();
  const hostname = hostnameOf(authority);
  if (authority && !LOOPBACK.has(hostname)) {
    sendJson(res, 403, { ok: false, error: "forbidden host" });
    return false;
  }
  if (String(req.headers["sec-fetch-site"] || "").toLowerCase() === "cross-site") {
    sendJson(res, 403, { ok: false, error: "forbidden site" });
    return false;
  }
  const origin = String(req.headers.origin || "").trim();
  if (origin === "null") {
    sendJson(res, 403, { ok: false, error: "forbidden origin" });
    return false;
  }
  if (origin) {
    try {
      const u = new URL(origin);
      if ((u.protocol !== "http:" && u.protocol !== "https:") || (authority && u.host.toLowerCase() !== authority.toLowerCase())) {
        sendJson(res, 403, { ok: false, error: "forbidden origin" });
        return false;
      }
    } catch {
      sendJson(res, 403, { ok: false, error: "forbidden origin" });
      return false;
    }
  }
  if (requireCsrf && String(req.headers["x-forge-csrf"] || "") !== csrfToken) {
    sendJson(res, 403, { ok: false, error: "missing or invalid csrf token" });
    return false;
  }
  return true;
}

async function readJsonBody(req) {
  const type = String(req.headers["content-type"] || "").toLowerCase();
  if (type && !type.startsWith("application/json")) {
    const err = new Error("unsupported content type");
    err.statusCode = 415;
    throw err;
  }
  const limit = 256 * 1024;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const err = new Error("request body too large");
      err.statusCode = 413;
      throw err;
    }
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error("invalid JSON body");
    err.statusCode = 400;
    throw err;
  }
}

function attachWorkbenchShell(html, csrfToken) {
  return html
    .replace("</head>", `<meta name="forge-csrf" content="${escapeHtml(csrfToken)}">\n</head>`)
    .replace("</body>", `<script src="/assets/workbench.js" defer></script>\n</body>`);
}

function compileFromBody(body, env) {
  const profile = loadProfile(body.profile || "generic");
  const model = loadModel(body.model || profile.model || "deepseek");
  const strat = body.strategy ? resolveStrategy({ strategy: body.strategy }) : {};
  const ctx = normalizeContext({
    hostId: profile.host,
    profileId: profile.id,
    home: env.home,
    projectRoot: env.projectRoot || process.cwd(),
    stateRoot: env.stateRoot,
    hostRoot: env.hostRoot,
    dshHome: env.dshHome,
    mode: body.mode || null,
    persona: body.persona || strat.persona || null,
    personaMode: body.personaMode || null,
    transform: body.transform || strat.transform || null,
    budget: Number(body.budget || 3200),
  });
  return compile(profile, model, ctx);
}

/**
 * Localhost workbench HTTP server (`127.0.0.1:7788`).
 * GET routes compute current host state per request; mutating POST `/api/*`
 * routes require loopback host/origin + per-boot CSRF token.
 */
export function createConsole({ state = () => ({}), env = {}, handlers = null, port = CONSOLE_PORT } = {}) {
  const csrfToken = crypto.randomBytes(16).toString("hex");
  const runtimeEnv = {
    projectRoot: env.projectRoot || process.cwd(),
    stateRoot: env.stateRoot || defaultStateRoot(env),
    home: env.home,
    hostRoot: env.hostRoot,
    dshHome: env.dshHome,
  };

  return http.createServer(async (req, res) => {
    const url = (req.url || "/").split("?")[0];

    if (req.method === "GET" && url === "/assets/workbench.js") {
      if (!allowConsoleRequest(req, res)) return;
      const js = fs.existsSync(WORKBENCH_JS_PATH) ? fs.readFileSync(WORKBENCH_JS_PATH, "utf8") : "";
      res.writeHead(200, {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(js);
      return;
    }

    if (req.method === "POST" && url.startsWith("/api/")) {
      if (!allowConsoleRequest(req, res, { requireCsrf: true, csrfToken })) return;
      try {
        const body = await readJsonBody(req);
        if (url === "/api/compile") {
          const plan = compileFromBody(body, runtimeEnv);
          const preview = previewPlan(plan, { env: runtimeEnv });
          return sendJson(res, 200, { ok: true, plan, preview });
        }
        if (url === "/api/probe") {
          const plan = compileFromBody(body, runtimeEnv);
          const result = runProbes({
            prompt: plan.prompt.text,
            persona: plan.prompt.persona?.id || null,
            transform: plan.transform || "none",
            budget: plan.budget.max,
          });
          return sendJson(res, 200, { ok: result.failed === 0, result, selfCheck: selfCheck(), planId: plan.planId });
        }
        if (url === "/api/apply-plan") {
          if (body.confirm !== true) return sendJson(res, 400, { ok: false, error: "explicit confirm: true required" });
          const plan = compileFromBody(body, runtimeEnv);
          const result = applyPlan(plan, { yes: true, preview: body.preview || null, env: runtimeEnv });
          return sendJson(res, result.ok ? 200 : 409, result);
        }
        if (url === "/api/verify-plan") {
          if (!body.planId) return sendJson(res, 400, { ok: false, error: "planId required" });
          return sendJson(res, 200, verifyPlan(body.planId, runtimeEnv));
        }
        if (url === "/api/revert-plan") {
          if (!body.planId) return sendJson(res, 400, { ok: false, error: "planId required" });
          return sendJson(res, 200, revertPlan(body.planId, { force: Boolean(body.force), env: runtimeEnv }));
        }
        if (url === "/api/snapshot") {
          const plan = compileFromBody(body, runtimeEnv);
          const written = writeSnapshot(runtimeEnv.stateRoot, { label: `prompt-${plan.profile.id}`, content: plan.prompt.text });
          const pruned = pruneSnapshots(runtimeEnv.stateRoot, SNAPSHOT_DEFAULTS);
          return sendJson(res, 200, { ok: true, written, pruned });
        }
        if (url === "/api/gateway/models") {
          const provider = resolveGateway(body.gateway || "default");
          assertGatewayUrl(provider.baseUrl);
          const models = await fetchModelIds(provider);
          return sendJson(res, 200, { ok: true, baseUrl: provider.baseUrl, models });
        }
        if (url === "/api/live-run") {
          if (!body.rawUser || typeof body.rawUser !== "string" || !body.rawUser.trim()) {
            return sendJson(res, 400, { ok: false, error: "rawUser prompt is required" });
          }
          const provider = resolveGateway(body.gateway || "default");
          assertGatewayUrl(provider.baseUrl);
          const plan = compileFromBody(body, runtimeEnv);
          const strat = resolveStrategy({
            strategy: body.strategy || null,
            persona: body.persona || null,
            wrap: body.wrap || null,
            script: body.script || null,
            prefill: body.prefill || null,
            stuffTokens: body.stuffTokens || null,
          });
          const resLive = await executeStrategyRequest(provider, {
            system: plan.prompt.text,
            rawUser: body.rawUser,
            model: body.model || "glm-5.3-flash",
            ...strat,
          }, {
            maxTokens: Math.min(Math.max(Number(body.maxTokens) || DEFAULT_MAX_TOKENS, 32), 4096),
            temperature: Number(body.temperature) || 0,
          });
          const refusal = resLive.status === "ok"
            ? detectRefusal(resLive.reply, { finishReason: resLive.finishReason, providerFlag: resLive.providerFlag })
            : { refused: null, signal: null };
          return sendJson(res, 200, {
            ok: resLive.status === "ok",
            status: resLive.status,
            model: body.model || "glm-5.3-flash",
            verdict: verdictOf(resLive, refusal),
            compliance: resLive.status === "ok" ? complianceOf(resLive.reply) : null,
            refused: refusal.refused,
            refusalSignal: refusal.signal,
            turns: resLive.turns,
            latencyMs: resLive.latencyMs,
            reply: resLive.reply || null,
            error: resLive.error || null,
          });
        }
        if (url.startsWith("/api/patches/") && handlers) {
          const op = url.slice("/api/patches/".length);
          if (op === "dry-run" && handlers.dryRun) return sendJson(res, 200, handlers.dryRun());
          if (body.confirm !== true) return sendJson(res, 400, { ok: false, error: "explicit confirm: true required" });
          if (op === "apply" && handlers.applyPatches) return sendJson(res, 200, handlers.applyPatches());
          if (op === "upgrade" && handlers.upgradePatches) return sendJson(res, 200, handlers.upgradePatches());
          if (op === "revert" && handlers.revertPatches) return sendJson(res, 200, handlers.revertPatches());
        }
        if (url === "/api/policy" && handlers?.setPolicy) {
          return sendJson(res, 200, { ok: true, policy: handlers.setPolicy(body.policy) });
        }
        if (url === "/api/prompt/install" && handlers?.installPrompt) {
          return sendJson(res, 200, { ok: true, ...handlers.installPrompt(body) });
        }
        return sendJson(res, 404, { ok: false, error: `unknown api route: ${url}` });
      } catch (error) {
        const status = error?.statusCode || (error?.code ? 400 : 500);
        return sendJson(res, status, { ok: false, code: error?.code || "error", error: error?.message || String(error) });
      }
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain" });
      res.end("read-only route; interactive mutations use POST /api/*\n");
      return;
    }
    if (!allowConsoleRequest(req, res)) return;
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
      return sendJson(res, 200, { ...payload, plans: payload.plans || listPlans({ stateRoot: runtimeEnv.stateRoot, hostRoot: runtimeEnv.hostRoot }) });
    }
    const html = url === "/patches"
      ? renderPatches(payload, { interactiveDsh: Boolean(handlers) })
      : RENDERERS[url](payload);
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": CSP_HEADER,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    res.end(attachWorkbenchShell(html, csrfToken));
  });
}
