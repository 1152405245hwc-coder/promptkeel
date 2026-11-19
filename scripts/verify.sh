#!/usr/bin/env bash
# Local verification: tests, client bundle, syntax, anchor check, privacy scan.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== tests"
node --test
echo "== profiles"
node scripts/verify-profiles.mjs
echo "== client build"
node scripts/build-client.mjs
node --check client/client.js
echo "== python tools"
python3 -B -c '
import ast, pathlib, sys
for p in sys.argv[1:]:
    ast.parse(pathlib.Path(p).read_text("utf-8"), filename=p)
' tools/abliterate/abliterate.py tools/eval/eval_refusal.py
echo "== anchor drift"
node --input-type=module -e '
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { hostRoot } from "./lib/paths.mjs";
import { hostStorageState } from "./lib/asar.mjs";
import { PATCHES } from "./lib/table.mjs";
import { normalizeFiles, replacementsOf } from "./lib/engine.mjs";

let root = hostRoot();
let tempDir = null;
if (hostStorageState(root).mode === "missing") {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-verify-host-"));
  root = tempDir;
  fs.mkdirSync(path.join(root, "node_modules", "@deepseek-ai"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.2.2-rc.3" }));
  for (const patch of PATCHES) {
    for (const rel of normalizeFiles(patch)) {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const body = replacementsOf(patch).map((r) => r.find).join("\n");
      fs.appendFileSync(abs, body + "\n");
    }
  }
}
try {
  const res = spawnSync(process.execPath, ["bin/promptkeel.js", "adapt", "--json", "--host-root", root], { encoding: "utf8" });
  const rows = JSON.parse(res.stdout);
  const bad = rows.filter((r) => r.status !== "ready");
  console.log(bad.length ? "drifted: " + bad.map((r) => r.id).join(", ") : `all ${rows.length} patches ready (${tempDir ? "synthetic fixture" : "local host"})`);
  process.exit(bad.length || res.status !== 0 ? 1 : 0);
} finally {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
}
'
echo "== docs facts"
node scripts/check_docs.mjs --check
echo "== privacy"
bash scripts/privacy_scan.sh
echo "VERDICT: PASS"
