import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { fail } from "./errors.mjs";
import { CONSOLE_CSS, escapeHtml } from "../ui/tokens.mjs";
import { listProfiles, listModels, loadProfile, loadModel } from "./contract.mjs";
import { compile, normalizeContext } from "./compile.mjs";
import { listModes } from "./prompt.mjs";
import { applyPlan, previewPlan, revertPlan, verifyPlan, listPlans, defaultStateRoot } from "./executor.mjs";
import { listPersonas } from "./persona.mjs";
import { TRANSFORMS } from "./transform.mjs";
import { runProbes, selfCheck, PROBES } from "./probe.mjs";
import { STRATEGIES, resolveStrategy } from "./strategy.mjs";
import {
  resolveGateway,
  resolveForgeModelId,
  fetchModelIds,
  executeStrategyRequest,
  detectRefusal,
  verdictOf,
  complianceOf,
  assertGatewayUrl,
  DEFAULT_MAX_TOKENS,
} from "./gateway.mjs";
import { writeSnapshot, pruneSnapshots, SNAPSHOT_DEFAULTS } from "./snapshot.mjs";
import { hostnameOf, LOOPBACK } from "./net.mjs";

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
const THEME_JS_PATH = path.resolve(import.meta.dirname, "..", "ui", "theme.js");
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

const NAV_GROUPS = [
  ["Inspect", [["/", "overview"], ["/audit", "audit"], ["/api/state", "api"]]],
  ["Author", [["/workbench", "workbench"], ["/live", "live"]]],
  ["Plan", [["/plans", "plans"], ["/patches", "patches"]]],
  ["Catalog", [["/channels", "channels"], ["/grades", "grades"], ["/personas", "personas"]]],
];

function chip(text, tone, attrs = "") {
  return `<span class="chip${tone ? ` ${tone}` : ""}"${attrs}>${escapeHtml(text)}</span>`;
}

function toneOf(value) {
  const s = String(value ?? "").toLowerCase();
  if (["ok", "ready", "hit", "applied", "pass", "replace-full", "delivered", "active", "present", "clear", "live"].includes(s)) return "ok";
  if (["warn", "partial", "research", "append-only", "configured", "verified-config", "reverted", "inactive", "idle", "pending", "restart", "unidentified", "unknown"].includes(s)) return "warn";
  if (["fail", "miss", "missing", "ambiguous", "unobservable", "error", "shim-only", "blocked", "withheld", "unsupported", "bad"].includes(s)) return "bad";
  return "";
}

function renderNav(route) {
  return NAV_GROUPS.map(([label, items]) => {
    const current = items.some(([href]) => href === route);
    const links = items.map(([href, text]) => `<a href="${href}"${href === route ? ' aria-current="page"' : ""}>${text}</a>`).join("");
    return `<div class="nav-group${current ? " is-current" : ""}" role="group" aria-label="${escapeHtml(label)}"><span class="nav-k" aria-hidden="true">${escapeHtml(label)}</span><span class="nav-links">${links}</span></div>`;
  }).join("");
}

function themeToggle() {
  return `<button type="button" class="theme-toggle" id="theme-toggle" role="switch" aria-checked="false" aria-label="Switch color theme"><svg class="theme-icon theme-icon-moon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M9.5 1.6a5.8 5.8 0 1 0 4.9 8.8A4.9 4.9 0 0 1 9.5 1.6z"/></svg><svg class="theme-icon theme-icon-sun" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M8 1.5v1.7M8 12.8v1.7M1.5 8h1.7M12.8 8h1.7M3.3 3.3l1.2 1.2M11.5 11.5l1.2 1.2M12.7 3.3l-1.2 1.2M4.5 11.5l-1.2 1.2"/></svg><span class="theme-label-dark">Dark</span><span class="theme-label-light">Light</span></button>`;
}

function layout(title, body, { route = "/", subtitle = "", modeLabel = "workbench" } = {}) {
  return `<!doctype html>
<html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PromptKeel · ${escapeHtml(title)}</title>
<style>${CONSOLE_CSS}</style></head>
<body>
<header class="top">
<div class="brand"><span class="mark" aria-hidden="true">K</span><span class="brand-name">PROMPTKEEL</span></div>
<nav class="nav" aria-label="Console">${renderNav(route)}</nav>
<div class="top-meta">${chip(modeLabel)}${chip("127.0.0.1", "", ` title="loopback"`)}${themeToggle()}</div>
</header>
<main class="wrap">
<div class="hero"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle || "local host facts and prompt compiler")}</p></div></div>
${body}
</main>
<footer>PromptKeel console · loopback 127.0.0.1 · state recomputed per request</footer>
</body></html>
`;
}

function card(label, value, hint = "", { bar = null, warn = false, tone = "", status = "" } = {}) {
  const toneName = tone || (warn ? "warn" : "");
  const toneAttr = toneName ? ` data-tone="${escapeHtml(toneName)}"` : "";
  const statusHtml = status ? `<div class="card-flag">${chip(status, toneName || (warn ? "warn" : ""))}</div>` : "";
  const pct = bar === null || bar === undefined ? null : Math.max(0, Math.min(100, Math.round(Number(bar) || 0)));
  const barClass = ["bar", (warn || toneName === "warn" || toneName === "bad") ? "warn" : "", toneName === "bad" ? "bad" : "", pct === 0 ? "is-empty" : ""].filter(Boolean).join(" ");
  const meter = pct === null ? "" : `<div class="meter-row"><div class="${barClass}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${escapeHtml(`${label} ${pct} percent`)}"><span style="width:${pct}%"></span></div><span class="meter-pct">${pct}%</span></div>`;
  const note = hint ? `<div class="hint">${escapeHtml(hint)}</div>` : "";
  return `<div class="card"${toneAttr}><div class="card-head"><div class="k">${escapeHtml(label)}</div>${statusHtml}</div><div class="v">${escapeHtml(value)}</div>${note}${meter}</div>`;
}

const STATUS_TOKEN = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/i;

/** Comma-separated `key:status` lists become chips. Ordinary sentences stay text. */
function parseStatusList(detail) {
  const text = String(detail ?? "").trim();
  if (!text.includes(",")) return null;
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2 || !parts.every((part) => STATUS_TOKEN.test(part))) return null;
  return parts.map((part) => {
    const index = part.indexOf(":");
    return { key: part.slice(0, index), status: part.slice(index + 1) };
  });
}

function renderStatusList(items) {
  const groups = [];
  const seen = new Map();
  for (const item of items) {
    let group = seen.get(item.status);
    if (!group) {
      group = { status: item.status, keys: [] };
      seen.set(item.status, group);
      groups.push(group);
    }
    group.keys.push(item.key);
  }
  const summary = `<div class="status-summary">${groups.map((group) => chip(`${group.keys.length} ${group.status}`, toneOf(group.status) || "warn")).join("")}</div>`;
  const body = groups.map((group) => {
    const tone = toneOf(group.status);
    const chips = group.keys.map((key) => `<span class="chip${tone ? ` ${tone}` : ""}" role="listitem" title="${escapeHtml(`${key}: ${group.status}`)}">${escapeHtml(key)}</span>`).join("");
    const heading = groups.length > 1 ? `<div class="chip-k">${escapeHtml(group.status)} <span class="chip-n">${group.keys.length}</span></div>` : "";
    return `${heading}<div class="chip-cloud" role="list" aria-label="${escapeHtml(`${group.keys.length} ${group.status}`)}">${chips}</div>`;
  }).join("");
  const n = items.length;
  return `<div class="status-detail">${summary}<details class="status-fold"><summary><span class="when-closed">Show ${n} items</span><span class="when-open">Hide ${n} items</span></summary>${body}</details></div>`;
}

function detailCell(detail) {
  const items = parseStatusList(detail);
  if (!items) return { v: detail || "", mono: true };
  return { rawHtml: renderStatusList(items) };
}

function table(columns, rows, rowAttrs = null) {
  const head = `<tr>${columns.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join("")}</tr>`;
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
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  const failing = fails + warns;
  const ready = Number(state.patches?.ready ?? 0);
  const total = Number(state.patches?.total ?? 0);
  const pct = total ? Math.round((ready / total) * 100) : 0;
  const activation = state.doctor?.activation;
  const hostVersion = state.host?.version || "unknown";
  const hostRooted = Boolean(state.host?.root);
  const hostIdentified = Boolean(state.host?.version) && hostVersion !== "unknown";
  const hostTone = !hostRooted ? "bad" : hostIdentified ? "ok" : "warn";
  const hostStatus = !hostRooted ? "no root" : hostIdentified ? "present" : "unidentified";
  const patchTone = !total || pct === 0 ? "bad" : pct === 100 ? "ok" : "warn";
  const patchStatus = !total ? "empty" : pct === 100 ? "ready" : pct === 0 ? "none ready" : "partial";
  const checkTone = fails ? "bad" : warns ? "warn" : "ok";
  const checkStatus = fails ? `${fails} fail` : warns ? `${warns} warn` : "clear";
  const actState = activation?.state || "unknown";
  const actTone = actState === "active" ? "ok" : "warn";
  const actStatus = actState === "active" ? "live" : activation?.requiresRestart ? "restart" : actState === "inactive" ? "idle" : actState === "configured" ? "pending" : actState;
  const cards = [
    card("host", hostIdentified ? hostVersion : "unknown", hostRooted ? "root resolved" : "root unknown", { tone: hostTone, status: hostStatus }),
    card("patches ready", `${ready}/${total}`, pct === 100 ? "all layers armed" : "anchor drift present", { bar: pct, warn: pct < 100, tone: patchTone, status: patchStatus }),
    card("checks", `${checks.length - failing}/${checks.length}`, failing ? `${failing} need attention` : "no drift", { tone: checkTone, status: checkStatus }),
    card("activation", actState, activation?.requiresRestart ? "restart required" : "no restart pending", { tone: actTone, status: actStatus }),
  ];
  const parts = [`<div class="grid">${cards.join("")}</div>`];
  if (checks.length) {
    parts.push(section("checks", table(["check", "status", "detail"], checks.map((c) => [c.label || c.id, { v: c.status, chip: true, tone: toneOf(c.status) }, detailCell(c.detail)]))));
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
  const modes = ["", ...(state.modes?.length ? state.modes : listModes())].map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m || "(auto)")}</option>`).join("");

  const controls = `<div class="pad" id="forge-workbench-root">
<div class="wb-main">
  <label class="field">Profile<select id="wb-profile">${profiles}</select></label>
  <label class="field">Model<select id="wb-model">${models}</select></label>
  <label class="field">Task Mode<select id="wb-mode">${modes}</select></label>
  <div class="wb-compile"><button type="button" class="btn primary" id="wb-compile-btn">Compile Plan</button></div>
</div>
<details class="advanced" id="wb-advanced">
  <summary>Advanced <span class="hint" id="wb-advanced-values">persona, persona mode, transform, strategy</span></summary>
  <div class="form-grid form-advanced">
    <label class="field">Persona<select id="wb-persona">${personas}</select></label>
    <label class="field">Persona Mode<select id="wb-persona-mode">${personaModes}</select></label>
    <label class="field">Transform<select id="wb-transform">${transforms}</select></label>
    <label class="field">Strategy<select id="wb-strategy">${strategies}</select></label>
  </div>
</details>
<div class="btn-groups" role="toolbar" aria-label="Plan actions">
  <div class="btn-row" role="group" aria-label="Check and keep">
    <button type="button" class="btn" id="wb-probe-btn">Run Static Probe (${PROBES.length})</button>
    <button type="button" class="btn" id="wb-copy-btn" aria-label="Copy compiled prompt">Copy Prompt</button>
    <button type="button" class="btn" id="wb-snapshot-btn">Save Snapshot</button>
  </div>
  <div class="btn-row" role="group" aria-label="Write to workspace">
    <button type="button" class="btn apply" id="wb-apply-btn">Preview &amp; Apply Plan</button>
  </div>
</div>
<div class="hint mono wb-note" id="wb-meta" aria-live="polite">Select a profile and compile.</div>
<div class="hint mono wb-probe" id="wb-probe-out" aria-live="polite"></div>
</div>`;

  const actionSec = section("compiled target actions", `<div class="scroll"><table><thead><tr><th scope="col">op</th><th scope="col">kind</th><th scope="col">change</th><th scope="col">target path</th></tr></thead><tbody id="wb-actions"></tbody></table></div>`);
  const promptTools = `<span class="sec-tools"><button type="button" class="btn" id="wb-copy-side" aria-label="Copy compiled prompt">Copy Prompt</button><button type="button" class="btn is-on" id="wb-wrap-btn" aria-pressed="true" aria-label="Toggle prompt line wrap">Wrap</button></span>`;
  const promptSec = section("compiled prompt", `<pre class="codebox" id="wb-prompt-out" tabindex="0" aria-label="Compiled prompt"></pre>`, promptTools);
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
  const forgeModels = [`<option value="">(auto by live model)</option>`, ...(state.models?.length ? state.models : listModels()).map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.id)}</option>`)].join("");
  const personas = [`<option value="">(none / strategy default)</option>`, ...(state.personas?.length ? state.personas : listPersonas()).map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.id)}</option>`)].join("");
  const strategies = STRATEGIES.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.id)} · ${escapeHtml(s.label)}</option>`).join("");
  const modes = ["", ...(state.modes?.length ? state.modes : listModes())].map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m || "(auto)")}</option>`).join("");
  const transforms = TRANSFORMS.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  const presetModels = ["glm-5.3-flash", "glm-5.3", "commandcode/deepseek/deepseek-v4-pro", "commandcode/deepseek/deepseek-v4.1-flash", "codex/gpt-6-luna", "group/free-strong"];
  const modelOptions = presetModels.map((id) => `<option value="${escapeHtml(id)}"></option>`).join("");
  const capabilityProbe = PROBES.find((p) => p.severity === "capability");
  const defaultPrompt = capabilityProbe?.request || "Outline a deterministic config serializer in Python.";

  const controls = `<div class="pad" id="forge-live-root">
<div class="form-grid">
  <label class="field">Gateway URL<input id="live-gateway" value="http://127.0.0.1:3425/v1" placeholder="default or http://127.0.0.1:3425/v1"></label>
  <label class="field">Live Model<input id="live-model" list="live-model-list" value="glm-5.3-flash" placeholder="model id (e.g. glm-5.3-flash)"><datalist id="live-model-list">${modelOptions}</datalist></label>
  <label class="field">Profile<select id="live-profile">${profiles}</select></label>
  <label class="field">Forge Model<select id="live-forge-model">${forgeModels}</select></label>
  <label class="field">Persona<select id="live-persona">${personas}</select></label>
  <label class="field">Strategy<select id="live-strategy">${strategies}</select></label>
  <label class="field">Task Mode<select id="live-mode">${modes}</select></label>
  <label class="field">Transform<select id="live-transform">${transforms}</select></label>
  <label class="field">Max Tokens<input id="live-max-tokens" type="number" value="512" min="64" max="4096"></label>
</div>
<label class="field" style="margin-top:12px">User Prompt<textarea id="live-prompt">${escapeHtml(defaultPrompt)}</textarea></label>
<div class="btn-row" style="margin-top:10px">
  <button type="button" class="btn" id="live-fetch-models">Fetch Gateway Models</button>
  <button type="button" class="btn primary" id="live-send-btn">Send Bounded Request</button>
  <span class="mono" id="live-status" style="font-size:12px;color:var(--dim)" aria-live="polite">ready · Magpie loopback :3425</span>
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
  if (!authority || !LOOPBACK.has(hostname)) {
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
      if ((u.protocol !== "http:" && u.protocol !== "https:") || u.host.toLowerCase() !== authority.toLowerCase()) {
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
    .replace("</head>", `<meta name="forge-csrf" content="${escapeHtml(csrfToken)}">\n<script src="/assets/theme.js"></script>\n</head>`)
    .replace("</body>", `<script src="/assets/workbench.js" defer></script>\n</body>`);
}

function compileFromBody(body, env) {
  const profile = loadProfile(body.profile || "generic");
  const requestedModel = body.forgeModel || body.modelForge || body.model;
  const modelId = resolveForgeModelId(requestedModel, profile.model || "deepseek");
  const model = loadModel(modelId);
  const strat = body.strategy ? resolveStrategy({ strategy: body.strategy }) : {};
  const persona = body.persona && body.persona !== "none" ? body.persona : (strat.persona || null);
  const ctx = normalizeContext({
    hostId: profile.host,
    profileId: profile.id,
    home: env.home,
    projectRoot: env.projectRoot || process.cwd(),
    stateRoot: env.stateRoot,
    hostRoot: env.hostRoot,
    dshHome: env.dshHome,
    mode: body.mode || null,
    persona,
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

    if (req.method === "GET" && (url === "/assets/workbench.js" || url === "/assets/theme.js")) {
      if (!allowConsoleRequest(req, res)) return;
      const file = url === "/assets/theme.js" ? THEME_JS_PATH : WORKBENCH_JS_PATH;
      const js = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
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
            persona: body.persona && body.persona !== "none" ? body.persona : null,
            transform: body.transform || null,
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
            forgeModel: plan.model.id,
            mode: plan.mode,
            strategy: resLive.strategyUsed || strat,
            verdict: verdictOf(resLive, refusal),
            compliance: resLive.status === "ok" ? complianceOf(resLive.reply) : null,
            refused: refusal.refused,
            refusalSignal: refusal.signal,
            turns: resLive.turns,
            latencyMs: resLive.latencyMs,
            usage: resLive.usage || null,
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
