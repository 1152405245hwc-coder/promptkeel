import { fail } from "./errors.mjs";

const SAFE_LINE = /^[^\r\n]{1,200}$/;

/**
 * A slash command is a small markdown file the host registers in a session.
 * It carries the composed prompt so running the command re-delivers it without
 * depending on any other target having been written first.
 */
export function renderCommand(composed, target = {}, profile = {}) {
  const description = target.description || `dsh-forge prompt for ${profile.id || "this profile"}`;
  const hint = target.hint || null;
  if (!SAFE_LINE.test(description)) fail("command-description", "command description must be one line");
  if (hint !== null && !SAFE_LINE.test(hint)) fail("command-hint", "command hint must be one line");
  const front = ["---", `description: ${description}`];
  if (hint) front.push(`argument-hint: ${hint}`);
  front.push("---");
  return `${front.join("\n")}\n\n${composed.text}`;
}
