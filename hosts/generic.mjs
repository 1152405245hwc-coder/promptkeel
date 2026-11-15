export const id = "generic";
export const label = "Generic chat / API";
export const support = "experimental";
export function detect() { return { ok: true, note: "prompt-only adapter" }; }
export function configTargets() { return { promptChannel: "system message" }; }
