import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { listProfiles } from "../core/contract.mjs";
import { compile } from "../core/compile.mjs";
import { loadModel } from "../core/profile.mjs";

// The composed prompt is a system message on top of whatever the host already sends; every
// extra hundred tokens is context the model cannot spend on the task. The ceiling is the
// contract: shrinking is free, regrowth has to be argued for in review.
const CEILING = 480;
const OVERLAY_CEILING = 1400; // bytes per prompt fragment

test("every profile composes under the prompt ceiling", () => {
  const rows = listProfiles().map((profile) => {
    const plan = compile(profile, loadModel(profile.model), { promptRoot: path.resolve("prompt") });
    return { id: profile.id, tokens: plan.prompt.tokens };
  });
  const over = rows.filter((row) => row.tokens >= CEILING);
  assert.deepEqual(over, [], `profiles over ${CEILING} tokens: ${over.map((r) => `${r.id}=${r.tokens}`).join(", ")}`);
});

test("no single prompt fragment drags the ceiling up by itself", () => {
  const root = path.resolve("prompt");
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
  const oversized = walk(root)
    .filter((file) => file.endsWith(".md"))
    .map((file) => ({ file: path.relative(root, file), bytes: fs.statSync(file).size }))
    .filter((row) => row.bytes > OVERLAY_CEILING);
  assert.deepEqual(oversized, []);
});
