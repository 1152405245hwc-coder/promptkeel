#!/usr/bin/env bash
# Pre-publication gate: privacy, history identity, package contents.
set -euo pipefail
cd "$(dirname "$0")/.."

die() { echo "release: $*" >&2; exit 1; }

bash scripts/privacy_scan.sh --history

tmp="$(mktemp -d "${TMPDIR:-/tmp}/forge-pack.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

npm_config_cache="${npm_config_cache:-$tmp/npm-cache}" npm pack --dry-run --json >"$tmp/pack.json" 2>"$tmp/pack.err" \
  || { cat "$tmp/pack.err" >&2; die "npm pack --dry-run failed"; }

node -e '
const fs = require("fs");
const [file, root] = process.argv.slice(1);
const bad = [];
const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
const files = (pkg[0] && pkg[0].files) || [];
for (const entry of files) {
  const name = entry.path;
  if (!fs.existsSync(name)) continue;
  if (/\.(png|jpg|jpeg|gif|webp|asar|tgz|zip)$/i.test(name)) continue;
  let text = "";
  try { text = fs.readFileSync(name, "utf8"); } catch { continue; }
  for (const [label, re] of [["home path", /\/Users\/[A-Za-z0-9._-]+/], ["linux home", /\/home\/[A-Za-z0-9._-]+/], ["noreply id", /[0-9]+\+[A-Za-z0-9_-]+@users\.noreply\.github\.com/]]) {
    if (re.test(text)) bad.push(`${name}: ${label}`);
  }
}
if (bad.length) {
  console.error("release: packed files carry local traces:");
  for (const line of bad) console.error("  " + line);
  process.exit(1);
}
console.log(`release: ${files.length} files packed, no local traces`);
' "$tmp/pack.json" "$PWD"

echo "release: gate passed"
