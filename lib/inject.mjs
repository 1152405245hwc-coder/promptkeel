import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { dshHome, promptInjectPath, ensureDir, ensureNotSymlink, writeFileAtomic, displayPath, VERSION } from "./paths.mjs";
import { dryRun } from "./engine.mjs";
import { PATCHES } from "./table.mjs";
import { readPolicy, shouldStripWorkspace, profileStatus } from "./preset.mjs";
import { estimateTokens, sha256 } from "../core/prompt.mjs";

export { estimateTokens, sha256 };

function findZstd() {
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, "zstd");
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* keep looking */ }
  }
  return "zstd";
}

export function composePrompt({ promptDir, adapter = "deepseek", mode = null } = {}) {
  const dir = promptDir || path.join(import.meta.dirname, "..", "prompt");
  const rootAbs = path.resolve(dir) + path.sep;
  const read = (file, { optional = false } = {}) => {
    const abs = path.resolve(dir, file);
    if (!abs.startsWith(rootAbs)) throw new Error(`prompt path escapes root: ${file}`);
    if (!fs.existsSync(abs)) {
      if (optional) return "";
      throw new Error(`prompt part missing: ${file}`);
    }
    return fs.readFileSync(abs, "utf8").trim();
  };
  const parts = [read("core.md")];
  if (adapter) {
    if (/[\\/]|\.\./.test(String(adapter))) throw new Error(`prompt path escapes subdir: ${adapter}`);
    const adapterText = read(path.join("adapters", `${adapter}.md`), { optional: true })
      || read(path.join("models", `${adapter}.md`), { optional: true });
    if (!adapterText) throw new Error(`unknown prompt adapter: ${adapter}`);
    parts.push(adapterText);
  }
  if (mode) {
    if (/[\\/]|\.\./.test(String(mode))) throw new Error(`prompt path escapes subdir: ${mode}`);
    parts.push(read(path.join("modes", `${mode}.md`)));
  }
  const body = parts.filter(Boolean).join("\n\n");
  const digest = sha256(body).slice(0, 12);
  const text = `<!-- dsh-forge v${VERSION} sha256:${digest} -->\n${body}\n`;
  return { text, tokens: estimateTokens(text), sha256: sha256(text), bodySha: digest };
}

export function checkBudget(composed, max = 3200) {
  return { ok: composed.tokens <= max, tokens: composed.tokens, max };
}

export function writeInject(composed, options = {}) {
  const target = options.path || promptInjectPath(options);
  ensureDir(path.dirname(target));
  ensureNotSymlink(target);
  let backup = null;
  if (fs.existsSync(target)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backup = `${target}.bak-${stamp}-${crypto.randomBytes(2).toString("hex")}`;
    fs.copyFileSync(target, backup);
  }
  writeFileAtomic(target, composed.text);
  const bytes = Buffer.byteLength(composed.text);
  return {
    path: target,
    backup,
    bytes,
    sha256: sha256(composed.text),
    message: `已写入 ${displayPath(target)}（${bytes} B）`,
  };
}

export function resolvePrompt(config = {}, env = {}) {
  const injectPath = promptInjectPath(env);
  let text = "";
  let hasUserInject = false;
  if (fs.existsSync(injectPath)) {
    const custom = fs.readFileSync(injectPath, "utf8");
    if (custom.trim().startsWith("<!-- dsh-forge ")) {
      text = custom;
      hasUserInject = true;
    }
  }
  if (!text) {
    text = composePrompt({
      promptDir: config.promptDir,
      adapter: config.adapter || "deepseek",
      mode: config.mode || null,
    }).text;
  }
  const policy = config.policy || readPolicy(env);
  const hasWorkspaceInject = ["AGENTS.md", "CLAUDE.md"].some((name) => fs.existsSync(path.join(process.cwd(), name)));
  const stripWorkspace = shouldStripWorkspace(policy, { hasUserInject, hasWorkspaceInject });
  const order = stripWorkspace ? 1000 : 500;
  return {
    text,
    order,
    policy,
    stripWorkspace,
    hasUserInject,
    tokens: estimateTokens(text),
    sha256: sha256(text),
  };
}

function workspaceSessionDir(base) {
  const cwd = process.cwd().replace(/^\//, "").replace(/ /g, "~0020").replace(/\//g, "-");
  return path.join(base, `--${cwd}--`);
}

function scanSessions(root) {
  if (!fs.existsSync(root)) return null;
  let best = null;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) stack.push(abs);
        else if (entry.name === "session.v4.jsonl.zstd") {
          const stat = fs.statSync(abs);
          if (!best || stat.mtimeMs > best.mtimeMs) best = { path: abs, mtimeMs: stat.mtimeMs };
        }
      } catch { /* ignore broken symlinks or permission errors */ }
    }
  }
  return best;
}

function findLatestSessionLog(env = {}) {
  const sessionsRoot = path.join(dshHome(env), "sessions");
  const primary = process.env.DSH_FORGE_SESSION_ROOT || workspaceSessionDir(sessionsRoot);
  return scanSessions(primary) || scanSessions(sessionsRoot);
}

export function verifyProofs({ promptDir, adapter = "deepseek", mode = null, env = {}, composed: precomposed = null, patchReport: preReport = null } = {}) {
  const proofs = [];
  const composed = precomposed || composePrompt({ promptDir, adapter, mode });
  const budget = checkBudget(composed);

  const patchReport = preReport || dryRun(PATCHES, env);
  const appliedCount = patchReport.patches.filter((p) => p.status === "applied").length;
  const readyCount = patchReport.patches.filter((p) => p.status === "hit" || p.status === "applied").length;
  proofs.push({
    id: "proof1-patches",
    name: "Host patches",
    status: appliedCount === PATCHES.length ? "pass" : readyCount === PATCHES.length ? "warn" : "fail",
    detail: appliedCount === PATCHES.length
      ? `${appliedCount}/${PATCHES.length} applied`
      : readyCount === PATCHES.length
        ? `${readyCount}/${PATCHES.length} ready (not applied yet; run dsh-forge apply --yes)`
        : patchReport.patches.filter((p) => !["hit", "applied"].includes(p.status)).map((p) => `${p.id}:${p.status}`).join(", "),
  });

  const injectPath = promptInjectPath(env);
  const exists = fs.existsSync(injectPath);
  const current = exists ? fs.readFileSync(injectPath, "utf8") : "";
  const fileMatches = exists && sha256(current) === composed.sha256;
  const profile = profileStatus(env);
  const registered = profile.exists && profile.enabled;
  proofs.push({
    id: "proof2-prompt",
    name: "Prompt channel",
    status: !budget.ok ? "fail" : registered ? "pass" : "warn",
    detail: !budget.ok
      ? `${composed.tokens}/${budget.max} tokens exceeds budget`
      : !registered
        ? `plugin section is ${composed.tokens}/${budget.max} tokens; dsh-forge is not registered in dsh.profile.bundles`
        : !exists
          ? `plugin section (${composed.tokens}/${budget.max} tokens, sha256:${composed.bodySha})`
          : fileMatches
            ? `plugin section + ${displayPath(injectPath)} synced (${composed.tokens}/${budget.max} tokens)`
            : `plugin section active (${composed.tokens}/${budget.max} tokens); ${displayPath(injectPath)} has custom content`,
  });

  const latest = findLatestSessionLog(env);
  let proof3 = { status: "warn", detail: "no session log found" };
  if (latest) {
    try {
      const zstd = process.env.DSH_FORGE_ZSTD || findZstd();
      const raw = execFileSync(zstd, ["-dc", latest.path], { maxBuffer: 64 * 1024 * 1024 });
      const text = raw.toString("utf8");
      const header = composed.text.split("\n")[0];
      proof3 = {
        status: text.includes(header) ? "pass" : "warn",
        detail: text.includes(header)
          ? `${displayPath(latest.path)} contains ${header}`
          : `${displayPath(latest.path)} has no forge header yet (start a new session after enabling dsh-forge)`,
      };
    } catch (error) {
      proof3 = { status: "warn", detail: `zstd unavailable: ${error.message}` };
    }
  }
  proofs.push({ id: "proof3-session", name: "Session log", ...proof3 });

  const byId = Object.fromEntries(proofs.map((p) => [p.id, p]));
  const ok = byId["proof1-patches"]?.status === "pass"
    && byId["proof2-prompt"]?.status === "pass"
    && proofs.every((p) => p.status !== "fail");
  return {
    ok,
    proofs,
    composed,
    budget,
  };
}

export function injectionSource(env = {}) {
  const inject = promptInjectPath(env);
  if (fs.existsSync(inject)) {
    const text = fs.readFileSync(inject, "utf8").trim();
    if (text.startsWith("<!-- dsh-forge ")) return { source: inject, kind: "prompt-inject" };
  }
  const agents = path.join(process.cwd(), "AGENTS.md");
  if (fs.existsSync(agents)) return { source: agents, kind: "agents-md" };
  return { source: null, kind: "builtin" };
}
