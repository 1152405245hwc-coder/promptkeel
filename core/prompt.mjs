import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { promptsDir } from "./contract.mjs";
import { applyPersona, loadPersona } from "./persona.mjs";
import { fail } from "./errors.mjs";
import { TRANSFORMS, encode } from "./transform.mjs";

export function estimateTokens(text) {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk / 1.7 + other / 4);
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readPart(root, rel, { optional = false } = {}) {
  const abs = path.resolve(root, rel);
  const rootAbs = path.resolve(root) + path.sep;
  if (!abs.startsWith(rootAbs)) fail("prompt-path", `prompt path escapes root: ${rel}`);
  if (!fs.existsSync(abs)) {
    if (optional) return null;
    fail("prompt-missing", `prompt part missing: ${rel}`, { file: abs });
  }
  return { rel, abs, text: fs.readFileSync(abs, "utf8").trim() };
}

/**
 * Deterministic prompt composition. The order is fixed:
 * core -> model overlay -> host overlay -> mode overlay.
 * No timestamps, hostnames or user paths enter the rendered bytes.
 */
export function renderPrompt({ profile, model, mode = null, persona = null, personaMode = null, transform = null, root = promptsDir() } = {}) {
  const bodyTransform = transform && transform !== "none" ? String(transform) : null;
  if (bodyTransform && !TRANSFORMS.includes(bodyTransform)) {
    fail("transform-kind", `unknown transform: ${bodyTransform}`, { known: TRANSFORMS });
  }
  if (!profile || !model) fail("prompt-args", "profile and model are required");
  const parts = [];
  parts.push(readPart(root, profile.prompt.core));
  parts.push(readPart(root, model.prompt));
  const hostPart = profile.host ? readPart(root, path.join("hosts", `${profile.host}.md`), { optional: true }) : null;
  if (hostPart) parts.push(hostPart);
  if (mode) {
    if (/[\\/]|\.\./.test(String(mode))) fail("prompt-path", `prompt mode escapes modes/: ${mode}`);
    parts.push(readPart(root, path.join("modes", `${mode}.md`)));
  }
  const resolved = persona ? loadPersona(persona, { root, mode: personaMode }) : null;
  const layered = applyPersona(parts.filter((p) => p.text), resolved);
  const raw = layered.map((p) => p.text).filter(Boolean).join("\n\n");
  const body = bodyTransform ? encode(raw, bodyTransform) : raw;
  const bodySha = sha256(body);
  const personaTransform = resolved && resolved.transform && resolved.transform !== "none" ? ` personaTransform=${resolved.transform}` : "";
  const personaTag = resolved && resolved.mode !== "off" ? ` persona=${resolved.id} personaMode=${resolved.mode}${personaTransform}` : "";
  const transformTag = bodyTransform ? ` transform=${bodyTransform}` : "";
  const hostTag = profile.host ? ` host=${profile.host}` : "";
  const header = `<!-- dsh-forge profile=${profile.id}${hostTag} model=${model.id}${mode ? ` mode=${mode}` : ""}${personaTag}${transformTag} sha256:${bodySha.slice(0, 16)} -->`;
  const text = `${header}\n${body}\n`;
  return {
    text,
    body,
    tokens: estimateTokens(text),
    sha256: sha256(text),
    bodySha,
    sources: layered.map((p) => p.rel),
    persona: resolved && resolved.mode !== "off" ? { id: resolved.id, mode: resolved.mode, transform: resolved.transform } : null,
    transform: bodyTransform,
  };
}
