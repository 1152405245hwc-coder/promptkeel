import { composePrompt, resolvePrompt, writeInject, verifyProofs, injectionSource } from "./inject.mjs";
import { doctor } from "./doctor.mjs";
import { dryRun, apply as applyPatches, revert, upgrade, listBackups } from "./engine.mjs";
import { readPolicy, setPolicy, POLICIES, profileStatus, enableProfile, disableProfile } from "./preset.mjs";
import { dshHome, promptInjectPath } from "./paths.mjs";
import { readLog, clearLogs } from "./log.mjs";

export const name = "dsh-forge";

// Only the prompt service is required; webServer is optional and injected lazily.
export const inject = ["systemPrompt"];

const FORGE_SECTION = "forge:prompt";

function registerPrompt(ctx, config) {
  let text = "";
  try {
    const resolved = resolvePrompt(config);
    text = resolved.text;
    const section = { name: FORGE_SECTION, order: resolved.order, text };
    const install = () => {
      if (ctx.systemPrompt && typeof ctx.systemPrompt.section === "function") return ctx.systemPrompt.section(section);
      if (typeof ctx.section === "function") return ctx.section(section);
      return undefined;
    };
    if (typeof ctx.effect === "function") {
      ctx.effect(() => {
        const dispose = install();
        return () => { if (typeof dispose === "function") dispose(); };
      });
    } else {
      install();
    }
  } catch (error) {
    console.warn("[dsh-forge] prompt section not registered:", error?.message || error);
  }
  return text;
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(data);
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

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

export function allowRequest(req, res, host) {
  const authority = String(req.headers.host || "").trim();
  const hostname = hostnameOf(authority);
  const trusted = new Set(LOOPBACK);
  const configured = host?.webServer?.host || host?.webServer?.hostname;
  if (configured) trusted.add(String(configured).replace(/^\[|\]$/g, "").toLowerCase());
  if (!authority || !trusted.has(hostname)) {
    json(res, 403, { ok: false, error: "forbidden host" });
    return false;
  }
  if (String(req.headers["sec-fetch-site"] || "").toLowerCase() === "cross-site") {
    json(res, 403, { ok: false, error: "forbidden site" });
    return false;
  }
  const origin = String(req.headers.origin || "").trim();
  if (origin === "null") {
    json(res, 403, { ok: false, error: "forbidden origin" });
    return false;
  }
  if (origin) {
    try {
      const u = new URL(origin);
      if ((u.protocol !== "http:" && u.protocol !== "https:") || u.host.toLowerCase() !== authority.toLowerCase()) {
        json(res, 403, { ok: false, error: "forbidden origin" });
        return false;
      }
    } catch {
      json(res, 403, { ok: false, error: "forbidden origin" });
      return false;
    }
  }
  return true;
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function readBody(req) {
  const limit = 256 * 1024;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw httpError(413, "request body too large");
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const type = String(req.headers["content-type"] || "").toLowerCase();
  if (type && !type.startsWith("application/json")) throw httpError(415, "unsupported content type");
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, "invalid JSON body");
  }
}

function installRoutes(host, cfg = {}) {
  if (!host.webServer || typeof host.webServer.register !== "function") return undefined;
  return host.webServer.register({
    kind: "prefix",
    path: "/dsh-forge/api",
    handler: async (req, res) => {
      try {
        if (!allowRequest(req, res, host)) return;
        const url = new URL(req.url, "http://127.0.0.1");
        const op = url.pathname.replace(/^\/dsh-forge\/api\/?/, "") || "status";
        if (req.method === "GET" && op === "status") return json(res, 200, { ok: true, doctor: doctor(), policy: readPolicy(), backups: listBackups(), source: injectionSource(), profile: profileStatus() });
        if (req.method === "GET" && op === "log") {
          const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
          return json(res, 200, { ok: true, entries: readLog(limit) });
        }
        if (req.method === "POST" && op === "log/clear") {
          return json(res, 200, { ok: true, ...clearLogs() });
        }
        if (req.method === "GET" && op === "prompt") {
          const composed = composePrompt({ adapter: cfg.adapter || "deepseek", mode: cfg.mode || null });
          return json(res, 200, { ok: true, text: composed.text, tokens: composed.tokens, sha256: composed.sha256, budget: 3200 });
        }
        if (req.method === "POST" && op === "prompt/install") {
          const composed = composePrompt({ adapter: cfg.adapter || "deepseek", mode: cfg.mode || null });
          return json(res, 200, { ok: true, ...writeInject(composed) });
        }
        if (req.method === "POST" && op === "apply") {
          const body = await readBody(req);
          return json(res, 200, body.dryRun ? dryRun() : applyPatches());
        }
        if (req.method === "POST" && op === "upgrade") {
          const body = await readBody(req);
          return json(res, 200, upgrade(undefined, {}, { dryRun: Boolean(body.dryRun) }));
        }
        if (req.method === "POST" && op === "revert") return json(res, 200, revert());
        if (req.method === "POST" && op === "verify") return json(res, 200, { ok: true, ...verifyProofs() });
        if (req.method === "POST" && op === "policy") {
          const body = await readBody(req);
          try {
            return json(res, 200, { ok: true, policy: setPolicy(body.policy) });
          } catch (err) {
            throw httpError(400, err.message);
          }
        }
        return json(res, 404, { ok: false, error: "unknown operation" });
      } catch (error) {
        if (error?.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
          return json(res, error.statusCode, { ok: false, error: error.message });
        }
        console.error("[dsh-forge] api error:", error?.message || error);
        return json(res, 500, { ok: false, error: "internal error" });
      }
    },
  });
}

export function apply(ctx, config = {}) {
  const cfg = { enabled: true, adapter: "deepseek", mode: null, ...config };
  if (!cfg.enabled) return;
  registerPrompt(ctx, cfg);
  queuedInstall(ctx, cfg);
  queuedCommands(ctx);
}

function queuedCommands(ctx) {
  if (typeof ctx.inject !== "function") return;
  ctx.inject(["commands"], (host) => {
    const commands = typeof host.get === "function" ? host.get("commands") : null;
    if (!commands || typeof commands.register !== "function") return;
    host.effect(() => {
      const dispose = commands.register({
        name: "forge",
        description: "DSH Forge: status | apply | upgrade | revert | verify | prompt",
        input: { hint: "status | apply | upgrade | revert | verify | prompt" },
        handler: async (invocation) => {
          const raw = String(invocation?.rawInput ?? "").trim().split(/\s+/)[0] || "status";
          try {
            if (raw === "apply") {
              const result = applyPatches();
              return { kind: result.ok ? "success" : "error", text: result.ok ? `applied ${result.changed.length} file(s), backup ${result.id}` : `apply blocked: ${result.reason}` };
            }
            if (raw === "upgrade") {
              const result = upgrade();
              return { kind: result.ok ? "success" : "error", text: result.ok ? `upgraded (${result.changed.length} file(s) written, backup ${result.id || "none"})` : `upgrade failed: ${result.reason}` };
            }
            if (raw === "revert") {
              const result = revert();
              return { kind: result.ok ? "success" : "error", text: result.ok ? `restored ${result.restored.length} file(s)` : `revert failed: ${result.reason || "unknown"}` };
            }
            if (raw === "verify") {
              const result = verifyProofs();
              return { kind: result.ok ? "success" : "error", text: result.proofs.map((p) => `${p.status.toUpperCase()} ${p.name}: ${p.detail}`).join("\n") };
            }
            if (raw === "prompt") {
              const composed = composePrompt();
              return { kind: "success", text: `${composed.tokens}/3200 tokens · sha256 ${composed.sha256.slice(0, 12)}` };
            }
            const report = doctor();
            return { kind: report.ok ? "success" : "error", text: report.checks.map((c) => `${c.status.toUpperCase()} ${c.label}: ${c.detail}`).join("\n") };
          } catch (error) {
            console.error("[dsh-forge] command error:", error?.message || error);
            return { kind: "error", text: "internal error; see host log" };
          }
        },
      });
      return () => { if (typeof dispose === "function") dispose(); };
    });
  });
}

function queuedInstall(ctx, cfg) {
  if (typeof ctx.inject !== "function") { installRoutes(ctx, cfg); return; }
  ctx.inject(["webServer"], (host) => {
    host.effect(() => {
      let dispose;
      try { dispose = installRoutes(host, cfg); } catch (error) { console.warn("[dsh-forge] routes:", error?.message || error); }
      return () => { if (typeof dispose === "function") dispose(); };
    });
  });
}

export const commands = {
  doctor: () => doctor(),
  apply: () => applyPatches(),
  upgrade: (options) => upgrade(undefined, {}, options),
  revert: () => revert(),
  status: () => ({ doctor: doctor(), policy: readPolicy(), backups: listBackups(), profile: profileStatus() }),
  policies: POLICIES,
  compose: (options) => composePrompt(options),
  installPrompt: (composed) => writeInject(composed),
  profileStatus: (env) => profileStatus(env),
  enableProfile: (env) => enableProfile(env),
  disableProfile: (env) => disableProfile(env),
  promptPath: promptInjectPath(),
  home: dshHome(),
};

export default { name, inject, apply };
