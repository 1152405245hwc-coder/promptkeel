/**
 * Model-family profiles for the persistent session runtime.
 *
 * A family is a deterministic strategy ladder plus transport traits. It is a
 * routing hint, not a claim about a vendor's policy: unknown models fall back
 * to `generic`, so every model still gets a complete ladder. The ladder is
 * ordered cheapest-first; the session engine only walks it when a turn fails.
 */
export const FAMILIES = [
  {
    id: "deepseek",
    match: ["deepseek", "dsk"],
    prefill: true,
    context: 131072,
    ladder: ["deliver", "contract", "contract+variable", "prefill", "stuff", "inline"],
  },
  {
    id: "claude",
    match: ["claude", "anthropic", "sonnet", "opus", "haiku"],
    prefill: true,
    context: 200000,
    ladder: ["contract", "deliver", "contract+variable", "prefill", "stuff", "inline"],
  },
  {
    id: "gpt",
    match: ["gpt", "openai", "o1", "o3", "o4", "chatgpt"],
    prefill: true,
    context: 128000,
    ladder: ["deliver", "variable", "contract", "prefill", "stuff", "inline"],
  },
  {
    id: "gemini",
    match: ["gemini", "google"],
    prefill: false,
    context: 1000000,
    ladder: ["contract", "contract+variable", "deliver", "stuff", "inline"],
  },
  {
    id: "glm",
    match: ["glm", "zhipu", "chatglm"],
    prefill: true,
    context: 128000,
    ladder: ["deliver", "contract", "contract+variable", "stuff", "inline"],
  },
  {
    id: "qwen",
    match: ["qwen", "tongyi", "dashscope"],
    prefill: true,
    context: 131072,
    ladder: ["deliver", "variable", "contract", "stuff", "inline"],
  },
  {
    id: "llama",
    match: ["llama", "meta-llama", "mistral", "mixtral", "local"],
    prefill: true,
    context: 32768,
    ladder: ["contract", "contract+variable", "deliver", "prefill", "inline"],
  },
  {
    id: "generic",
    match: [],
    prefill: true,
    context: 32768,
    ladder: ["deliver", "contract", "contract+variable", "prefill", "stuff", "inline"],
  },
];

export const GENERIC_FAMILY = "generic";

/** Resolve a live model id to a family descriptor. */
export function familyFor(model) {
  const lower = String(model ?? "").toLowerCase();
  if (!lower) return FAMILIES[FAMILIES.length - 1];
  for (const family of FAMILIES) {
    if (family.match.some((needle) => lower.includes(needle))) return family;
  }
  return FAMILIES[FAMILIES.length - 1];
}

export function familyById(id) {
  return FAMILIES.find((family) => family.id === String(id || "")) || null;
}

/** Ordered arm ids for a family; unknown ids fall back to the generic ladder. */
export function ladderFor(familyId) {
  const family = familyById(familyId) || familyById(GENERIC_FAMILY);
  return [...family.ladder];
}

export function supportsPrefill(familyId) {
  const family = familyById(familyId);
  return family ? family.prefill !== false : true;
}
