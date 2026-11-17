import path from "node:path";
import { sha256, renderPrompt } from "./prompt.mjs";
import { preflight } from "./capabilities.mjs";
import { normalizeProfile, validateModel } from "./contract.mjs";
import { fail } from "./errors.mjs";
import { getAdapter } from "../hosts/registry.mjs";
import { summarizeChannels } from "./channels.mjs";
import { renderCommand } from "./command.mjs";
import { gradeOf } from "./grades.mjs";
import { detectWithAdapter } from "../hosts/adapter.mjs";

function targetMetadataEnabled(profile) {
  return Boolean(profile.__adapterExplicit)
    || Boolean(profile.__activationExplicit)
    || Boolean(profile.__targetMetadataExplicit);
}

function withTargetMetadata(action, target, profile) {
  if (!targetMetadataEnabled(profile)) return action;
  return {
    ...action,
    targetId: target.id,
    required: target.required,
    owner: target.owner,
    conflict: target.conflict,
  };
}

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
export function compile(profile, model, { mode = null, persona = null, personaMode = null, transform = null, home, projectRoot, promptRoot, budget = 3200, env } = {}) {
  const normalizedProfile = normalizeProfile(profile);
  validateModel(model);
  const maxTokens = Number(budget);
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) fail("budget", `budget must be a positive integer, got ${budget}`);
  if (!model.hosts.includes(normalizedProfile.host)) {
    fail("model-host-mismatch", `model ${model.id} does not target host ${normalizedProfile.host}`, { model: model.id, host: normalizedProfile.host });
  }
  const adapter = getAdapter(normalizedProfile.adapter || normalizedProfile.host);
  const adapterContext = { home, projectRoot, mode, profile: normalizedProfile, model, env };
  let detection;
  let adapterPreflight = { ok: true, problems: [], warnings: [] };
  try {
    detection = detectWithAdapter(adapter, adapterContext);
    if (typeof adapter.preflight === "function") {
      adapterPreflight = adapter.preflight(normalizedProfile, detection, adapterContext) || { ok: true, problems: [], warnings: [] };
    }
  } catch (error) {
    if (error?.code) throw error;
    fail("adapter-unavailable", `adapter ${adapter.id} preflight failed: ${error.message}`, { adapter: adapter.id });
  }
  if (adapterPreflight.ok === false) {
    fail("adapter-unavailable", `adapter ${adapter.id} preflight failed`, {
      adapter: adapter.id,
      problems: adapterPreflight.problems || [],
      warnings: adapterPreflight.warnings || [],
    });
  }
  const pre = preflight(normalizedProfile, { host: normalizedProfile.host, model });
  if (!pre.ok) fail("preflight", "profile preflight failed", { problems: pre.problems });
  const composed = renderPrompt({ profile: normalizedProfile, model, mode, persona, personaMode, transform, root: promptRoot });
  const actions = [];
  const compileContext = {
    profile: normalizedProfile,
    model,
    mode,
    composed,
    persona: composed.persona,
    home,
    projectRoot,
    promptRoot,
    env,
    adapter,
  };
  for (const target of normalizedProfile.targets) {
    const abs = target.kind === "dsh-patches"
      ? null
      : target.kind === "prompt-only"
        ? null
        : resolveTargetPath(target, { home, projectRoot });
    if (typeof adapter.compileTarget === "function") {
      const custom = adapter.compileTarget(target, { ...compileContext, path: abs });
      if (custom !== undefined) {
        const customActions = Array.isArray(custom) ? custom : [custom];
        for (const action of customActions) {
          if (!action || typeof action !== "object") fail("adapter-action", `adapter ${adapter.id} returned an invalid action`, { target: target.id });
          actions.push(withTargetMetadata(action, target, normalizedProfile));
        }
        continue;
      }
    }
    const targetMetadata = targetMetadataEnabled(normalizedProfile)
      ? { targetId: target.id, required: target.required, owner: target.owner, conflict: target.conflict }
      : {};
    switch (target.kind) {
      case "markdown-block":
        actions.push({
          op: "merge-block",
          kind: target.kind,
          path: abs,
          scope: target.scope || "project",
          blockId: target.blockId || "system",
          content: composed.text,
          ...targetMetadata,
        });
        break;
      case "file":
        actions.push({
          op: "write-file",
          kind: target.kind,
          path: abs,
          scope: target.scope || "project",
          content: composed.text,
          ...targetMetadata,
        });
        break;
      case "command":
        actions.push({
          op: "write-file",
          kind: target.kind,
          path: abs,
          scope: target.scope || "project",
          content: renderCommand(composed, target, normalizedProfile),
          ...targetMetadata,
        });
        break;
      case "json-merge":
        actions.push({
          op: "merge-json",
          kind: target.kind,
          path: abs,
          scope: target.scope || "project",
          value: target.value,
          ...targetMetadata,
        });
        break;
      case "toml-merge":
        actions.push({
          op: "merge-toml",
          kind: target.kind,
          path: abs,
          scope: target.scope || "project",
          value: target.value,
          ...targetMetadata,
        });
        break;
      case "dsh-patches":
        actions.push({ op: "dsh-patches", kind: target.kind, patches: target.patches || "all", ...targetMetadata });
        break;
      case "prompt-only":
        actions.push({ op: "prompt-only", kind: target.kind, ...targetMetadata });
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
  const canonicalTargets = normalizedProfile.targets.map((target) => ({
    kind: target.kind,
    scope: target.scope || "project",
    path: target.path || null,
    blockId: target.blockId || null,
    value: target.value || null,
    patches: target.patches || null,
  }));
  const metadataEnabled = targetMetadataEnabled(normalizedProfile);
  const digestInput = JSON.stringify({
    profile: {
      id: normalizedProfile.id,
      version: normalizedProfile.version,
      host: normalizedProfile.host,
      ...(metadataEnabled ? { adapter: adapter.id, adapterVersion: adapter.adapterVersion } : {}),
    },
    model: { id: model.id, version: model.version || null },
    mode,
    promptSha: composed.sha256,
    targets: metadataEnabled
      ? normalizedProfile.targets.map((target, index) => ({ ...canonicalTargets[index], id: target.id, required: target.required, owner: target.owner, conflict: target.conflict }))
      : canonicalTargets,
  });
  const planId = sha256(digestInput).slice(0, 16);
  const channelSummary = summarizeChannels(actions, { projectRoot });
  return {
    schema: "forge.plan/v1",
    planId,
    profile: {
      id: normalizedProfile.id,
      version: normalizedProfile.version,
      name: normalizedProfile.name,
      host: normalizedProfile.host,
      adapter: adapter.id,
      support: normalizedProfile.support || pre.support,
      risk: normalizedProfile.risk || pre.risk,
      mutatesHost: normalizedProfile.mutatesHost ?? false,
      requiresRestart: normalizedProfile.requiresRestart ?? (normalizedProfile.activation.restart === "required" || normalizedProfile.host !== "generic"),
      activationEvidence: normalizedProfile.activation.evidence,
      platform: normalizedProfile.platform,
      activation: normalizedProfile.activation,
    },
    adapter: {
      id: adapter.id,
      adapterVersion: adapter.adapterVersion,
      schema: adapter.schema,
      detection,
      preflight: { ok: adapterPreflight.ok !== false, warnings: adapterPreflight.warnings || [] },
    },
    model: { id: model.id, version: model.version || null },
    mode,
    persona: composed.persona,
    transform: composed.transform,
    prompt: {
      sha256: composed.sha256,
      bodySha: composed.bodySha,
      tokens: composed.tokens,
      sources: composed.sources,
      text: composed.text,
      persona: composed.persona,
      transform: composed.transform,
    },
    budget: { tokens: composed.tokens, max: maxTokens, ok: composed.tokens <= maxTokens },
    capabilities: pre.rows,
    channels: channelSummary,
    delivery: gradeOf({ ...normalizedProfile, __channels: channelSummary.counts }),
    actions,
  };
}
