import fs from "node:fs";
import path from "node:path";

export const id = "muse";
export const label = "Muse";
export const support = "unsupported";

/** Muse sends its system prompt from the service; the bundle carries feature
 * gates only. Nothing here can be replaced without re-signing the app, so the
 * profile compiles a prompt for manual use and claims no activation. */
export function detect({ home = process.env.HOME || process.env.USERPROFILE } = {}) {
  const candidates = [
    "/Applications/Muse.app/Contents/Resources/hatch/index.html",
    ...(home ? [path.join(home, "Library", "Application Support", "Muse")] : []),
  ];
  return { ok: candidates.some((p) => fs.existsSync(p)), candidates, confidence: "medium" };
}

export function configTargets() {
  return { promptFile: null, reason: "server-side system prompt; no local replace surface" };
}
