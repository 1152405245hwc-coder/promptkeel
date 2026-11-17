import fs from "node:fs";
import path from "node:path";
import { promptsDir } from "./contract.mjs";
import { fail } from "./errors.mjs";
import { TRANSFORMS, encode, reversible } from "./transform.mjs";

export const PERSONA_MODES = ["replace", "strict", "append", "off"];

const DEFAULT_HOST_WORDS = [
  "deepseek",
  "dsh",
  "harness",
  "codex",
  "claude",
  "gemini",
  "cursor",
  "windsurf",
  "aider",
  "opencode",
  "continue",
];

/**
 * A host self-description line is any line that opens with a first-person
 * identity claim and names the host. Lines that merely mention the host while
 * describing behaviour are kept: removing those would delete working rules.
 */
const IDENTITY_OPENERS = /^\s*(?:you are|you're|you were built|i am|i'm)\b/i;

export function personaRoot(root = promptsDir()) {
  return path.join(root, "personas");
}

function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return { meta: {}, body: text.trim() };
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) fail("persona-frontmatter", "persona frontmatter is not closed");
  const head = text.slice(4, end);
  const meta = {};
  for (const line of head.split("\n")) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    const key = line.slice(0, at).trim();
    const raw = line.slice(at + 1).trim();
    if (!key) continue;
    meta[key] = raw;
  }
  return { meta, body: text.slice(end + 5).trim() };
}

export function listPersonas(root = promptsDir()) {
  const dir = personaRoot(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => {
      const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(dir, name), "utf8"));
      return {
        id: meta.id || name.replace(/\.md$/, ""),
        name: meta.name || meta.id || name.replace(/\.md$/, ""),
        mode: meta.mode || "replace",
        harness: meta.harness || "any",
        transform: TRANSFORMS.includes(meta.transform) ? meta.transform : "none",
        reversible: TRANSFORMS.includes(meta.transform) ? reversible(meta.transform) : true,
        chars: body.length,
        file: path.join(dir, name),
      };
    });
}

export function loadPersona(id, { root = promptsDir(), mode = null } = {}) {
  if (!id) return null;
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(String(id))) fail("persona-id", `invalid persona id: ${id}`);
  const file = path.join(personaRoot(root), `${id}.md`);
  if (!fs.existsSync(file)) {
    const known = listPersonas(root).map((p) => p.id).join(", ") || "(none)";
    fail("persona-missing", `persona not found: ${id}`, { file, known });
  }
  const { meta, body } = parseFrontmatter(fs.readFileSync(file, "utf8"));
  if (!body) fail("persona-empty", `persona ${id} has no body text`, { file });
  const resolvedMode = String(mode || meta.mode || "replace");
  if (!PERSONA_MODES.includes(resolvedMode)) {
    fail("persona-mode", `unknown persona mode: ${resolvedMode}`, { known: PERSONA_MODES });
  }
  const transform = String(meta.transform || "none");
  const lead = String(meta.lead || "").trim();
  if (!TRANSFORMS.includes(transform)) {
    fail("transform-kind", `unknown persona transform: ${transform}`, { file, known: TRANSFORMS });
  }
  return {
    id: meta.id || id,
    name: meta.name || meta.id || id,
    mode: resolvedMode,
    harness: meta.harness || "any",
    transform,
    lead,
    body,
    file,
  };
}

/**
 * Lines that would re-introduce the host's own self-description. Exported so
 * the probe harness can measure identity leakage with the same rule the
 * rewriter uses to remove it.
 */
export function identityLines(text, hostWords) {
  const words = hostWords && hostWords.length ? hostWords : DEFAULT_HOST_WORDS;
  return String(text ?? "")
    .split("\n")
    .filter((line) => {
      if (!IDENTITY_OPENERS.test(line)) return false;
      const lower = line.toLowerCase();
      return words.some((word) => lower.includes(word));
    });
}

function stripIdentity(text, hostWords) {
  const words = hostWords && hostWords.length ? hostWords : DEFAULT_HOST_WORDS;
  const kept = text
    .split("\n")
    .filter((line) => !identityLines(line, words).length);
  return kept.join("\n").trim();
}

/**
 * Apply a persona to an ordered list of prompt parts. The mode vocabulary
 * matches agent-purge: replace keeps host rules minus identity claims, strict
 * keeps the persona alone, append keeps everything and adds the persona last.
 */
export function applyPersona(parts, persona, { mode = null, hostWords } = {}) {
  if (!persona) return parts;
  const resolved = mode || persona.mode || "replace";
  if (!PERSONA_MODES.includes(resolved)) fail("persona-mode", `unknown persona mode: ${resolved}`, { known: PERSONA_MODES });
  const transform = persona.transform && persona.transform !== "none" ? persona.transform : null;
  const encoded = transform ? encode(persona.body, transform) : persona.body;
  const lead = persona.lead || "";
  const part = {
    rel: `personas/${persona.id}.md`,
    abs: persona.file,
    text: lead ? `${lead}\n\n${encoded}` : encoded,
    persona: persona.id,
    transform,
  };
  if (resolved === "off") return parts;
  if (resolved === "strict") return [part];
  if (resolved === "append") return [...parts, part];
  const stripped = parts
    .map((p) => ({ ...p, text: stripIdentity(p.text, hostWords) }))
    .filter((p) => p.text);
  return [part, ...stripped];
}
