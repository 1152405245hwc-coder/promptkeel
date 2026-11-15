import path from "node:path";
import { sha256, renderPrompt } from "./prompt.mjs";
import { preflight } from "./capabilities.mjs";
import { validateProfile, validateModel } from "./contract.mjs";
import { fail } from "./errors.mjs";

export function resolveTargetPath(target, { home = process.env.HOME || process.env.USERPROFILE, projectRoot = process.cwd() } = {}) {
  const scope = target.scope || "project";
  if (scope === "absolute") return path.resolve(target.path);
  const base = scope === "user" ? home : projectRoot;
  if (!base) fail("target-scope", `cannot resolve ${scope} target without a base directory`);
  const root = path.resolve(base);
  const resolved = path.resolve(root, target.path);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    fail("target-escape", `target escapes ${scope} root: ${target.path}`);
  }
  return resolved;
}

/**
 * Compile a profile into a pure data plan. This function performs no writes.
 * Identical inputs must produce an identical planId on every machine.
 */
export function compile(profile, model, { mode = null, home, projectRoot, promptRoot, budget = 3200 } = {}) {
  validateProfile(profile);
  validateModel(model);
  const maxTokens = Number(budget);
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) fail("budget", `budget must be a positive integer, got ${budget}`);
  if (!model.hosts.includes(profile.host)) {
    fail("model-host-mismatch", `model ${model.id} does not target host ${profile.host}`, { model: model.id, host: profile.host });
  }
  const pre = preflight(profile, { host: profile.host, model });
  if (!pre.ok) fail("preflight", "profile preflight failed", { problems: pre.problems });
  const composed = renderPrompt({ profile, model, mode, root: promptRoot });
  const actions = [];
  for (const target of profile.targets) {
    const abs = target.kind === "dsh-patches"
      ? null
      : target.kind === "prompt-only"
        ? null
        : resolveTargetPath(target, { home, projectRoot });
    switch (target.kind) {
      case "markdown-block":
        actions.push({
          op: "merge-block",
          kind: target.kind,
          path: abs,
          scope: target.scope || "project",
          blockId: target.blockId || "system",
          content: composed.text,
        });
        break;
      case "file":
        actions.push({
          op: "write-file",
          kind: target.kind,
          path: abs,
          scope: target.scope || "project",
          content: composed.text,
        });
        break;
      case "json-merge":
        actions.push({
          op: "merge-json",
          kind: target.kind,
          path: abs,
          scope: target.scope || "project",
          value: target.value,
        });
        break;
      case "toml-merge":
        actions.push({
          op: "merge-toml",
          kind: target.kind,
          path: abs,
          scope: target.scope || "project",
          value: target.value,
        });
        break;
      case "dsh-patches":
        actions.push({ op: "dsh-patches", kind: target.kind, patches: target.patches || "all" });
        break;
      case "prompt-only":
        actions.push({ op: "prompt-only", kind: target.kind });
        break;
      default:
        fail("target-kind", `unsupported target kind ${target.kind}`);
    }
  }
  actions.sort((a, b) => {
    const ka = `${a.op}:${a.scope || ""}:${a.path || ""}`;
    const kb = `${b.op}:${b.scope || ""}:${b.path || ""}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  // planId must be machine-independent: never hash absolute target paths.
  const canonicalTargets = profile.targets.map((target) => ({
    kind: target.kind,
    scope: target.scope || "project",
    path: target.path || null,
    blockId: target.blockId || null,
    value: target.value || null,
    patches: target.patches || null,
  }));
  const digestInput = JSON.stringify({
    profile: { id: profile.id, version: profile.version, host: profile.host },
    model: { id: model.id, version: model.version || null },
    mode,
    promptSha: composed.sha256,
    targets: canonicalTargets,
  });
  const planId = sha256(digestInput).slice(0, 16);
  return {
    schema: "forge.plan/v1",
    planId,
    profile: { id: profile.id, version: profile.version, name: profile.name, host: profile.host, support: profile.support || pre.support },
    model: { id: model.id, version: model.version || null },
    mode,
    prompt: { sha256: composed.sha256, bodySha: composed.bodySha, tokens: composed.tokens, sources: composed.sources, text: composed.text },
    budget: { tokens: composed.tokens, max: maxTokens, ok: composed.tokens <= maxTokens },
    capabilities: pre.rows,
    actions,
  };
}
