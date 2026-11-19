#!/usr/bin/env bash
# Repository-level quality gate. This is intentionally narrower than verify.sh:
# it checks release hygiene, reproducible installation, and CLI/package shape.
set -euo pipefail
cd "$(dirname "$0")/.."

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/dsh-forge-check.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

echo "== tracked generated state"
if git ls-files -z | grep -zEq '(^|/)(\.dsh-forge-state|\.dsh-forge|\.dsh-forge-kit-state|\.dsh-forge-kit|\.promptkeel-state|\.promptkeel|node_modules)(/|$)|\.tgz$'; then
  echo "generated or dependency artifacts are tracked" >&2
  exit 1
fi

echo "== schema and profile compilation"
node scripts/verify-profiles.mjs

echo "== CLI surface"
help="$(node bin/dsh-forge.js --help)"
for command in doctor status apply verify compile audit plans verify-plan revert-plan profiles hosts models session; do
  grep -Fq "promptkeel ${command}" <<<"$help" || {
    echo "CLI help is missing command: ${command}" >&2
    exit 1
  }
done
session_help="$(node bin/dsh-session.js --help)"
for command in start turn record status list export archive matrix; do
  grep -Fq "promptkeel-session ${command}" <<<"$session_help" || {
    echo "promptkeel-session help is missing command: ${command}" >&2
    exit 1
  }
done

echo "== JavaScript syntax"
while IFS= read -r -d '' file; do
  node --check "$file"
done < <(find bin core hosts lib scripts test -type f \( -name '*.mjs' -o -name '*.js' \) -print0 | sort -z)

echo "== core DSH import boundary"
if rg -n 'from .*\.\./lib/' core/; then
  echo "core modules must not import DSH runtime modules in lib/" >&2
  exit 1
fi

echo "== lockfile consistency"
node --input-type=module <<'NODE'
import fs from "node:fs";
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
if (lock.lockfileVersion < 3) throw new Error("package-lock.json must use lockfileVersion 3+");
if (lock.name !== pkg.name || lock.version !== pkg.version) throw new Error("package-lock root metadata does not match package.json");
const root = lock.packages?.[""];
if (!root || root.name !== pkg.name || root.version !== pkg.version) throw new Error("package-lock packages[''] metadata does not match package.json");
for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
  const expected = JSON.stringify(pkg[section] || {});
  const actual = JSON.stringify(root[section] || {});
  if (expected !== actual) throw new Error(`package-lock ${section} is out of sync`);
}
console.log(`lockfile v${lock.lockfileVersion}: ${Object.keys(lock.packages || {}).length} package entries`);
NODE

echo "== privacy"
bash scripts/privacy_scan.sh

echo "== package contents"
npm --cache "$tmp_dir/npm-cache" pack --dry-run --json >"$tmp_dir/pack.json"
node --input-type=module - "$tmp_dir/pack.json" <<'NODE'
import fs from "node:fs";
const report = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const files = new Set(report[0]?.files?.map((entry) => entry.path) || []);
for (const required of ["package.json", "bin/dsh-forge.js", "bin/dsh-session.js", "client/client.js", "docs/assets/hero.svg", "scripts/verify.sh"]) {
  if (!files.has(required)) throw new Error(`package is missing ${required}`);
}
for (const forbidden of [".dsh-forge-state/", ".dsh-forge-kit-state/", ".dsh-forge-kit/", ".promptkeel-state/", ".promptkeel/", "docs/research/", "tools/", "node_modules/", ".git/"]) {
  if ([...files].some((file) => file.startsWith(forbidden))) throw new Error(`package contains ${forbidden}`);
}
console.log(`package files: ${files.size}`);
NODE

echo "== release metadata"
node --input-type=module <<'NODE'
import fs from "node:fs";
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const log = fs.readFileSync("CHANGELOG.md", "utf8");
const heading = new RegExp(`^## \\[${pkg.version.replace(/\./g, "\\.")}\\]`, "m");
if (!heading.test(log)) throw new Error(`CHANGELOG.md has no section for ${pkg.version}`);
const paths = fs.readFileSync("lib/paths.mjs", "utf8");
const fallback = paths.match(/PKG\.version \|\| "([^"]+)"/);
if (!fallback) throw new Error("lib/paths.mjs: VERSION fallback not found");
if (fallback[1] !== pkg.version) throw new Error(`lib/paths.mjs fallback ${fallback[1]} != package.json ${pkg.version}`);
console.log(`release: ${pkg.version} has a changelog section and a matching version fallback`);
NODE

echo "== diff hygiene"
git diff --check
echo "check:repo PASS"
