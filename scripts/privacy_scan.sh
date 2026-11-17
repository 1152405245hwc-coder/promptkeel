#!/usr/bin/env bash
# Fail if the repository contains private data, credentials or local traces.
#
# Usage:
#   privacy_scan.sh            scan tracked and untracked working files
#   privacy_scan.sh --history  also check commit author identities
#
# Override the allowed commit identity for the history check with
# .privacy-allow (one address per line, git-ignored).
set -euo pipefail
cd "$(dirname "$0")/.."

check_history=0
[ "${1:-}" = "--history" ] && check_history=1

patterns=(
  '/Users/[A-Za-z0-9._-]+'
  '/home/[A-Za-z0-9._-]+'
  '[A-Za-z]:\\+Users\\+[A-Za-z0-9._-]+'
  'sk-[A-Za-z0-9]{20,}'
  'ghp_[A-Za-z0-9]{20,}'
  'github_pat_[A-Za-z0-9_]{20,}'
  'xox[abprs]-[A-Za-z0-9-]{10,}'
  'AIza[0-9A-Za-z_-]{35}'
  'AKIA[0-9A-Z]{16}'
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
  '[0-9]+\+[A-Za-z0-9_-]+@users\.noreply\.github\.com'
  'password[[:space:]]*[:=][[:space:]]*[^[:space:]]+'
  'Bearer[[:space:]]+[A-Za-z0-9._-]{20,}'
  'ds-[A-Za-z0-9]{20,}'
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
)

status=0
tmp="$(mktemp -t forge-privacy)"
trap 'rm -f "$tmp"' EXIT

for p in "${patterns[@]}"; do
  if grep -RInE \
    --exclude-dir=.git \
    --exclude-dir=node_modules \
    --exclude-dir=.dsh-forge-state \
    --exclude-dir=.privacy-allow \
    --exclude=privacy_scan.sh \
    "$p" . >"$tmp" 2>/dev/null; then
    echo "privacy: matched pattern: $p"
    sed -n '1,5p' "$tmp"
    status=1
  fi
done

# Images ship in the npm package; fail if any of them carries text metadata.
if ! node -e '
const fs = require("fs");
const path = require("path");
const bad = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.png$/i.test(entry.name)) checkPng(full);
  }
}
function checkPng(file) {
  const buf = fs.readFileSync(file);
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    if (type === "tEXt" || type === "iTXt" || type === "zTXt") bad.push(`${file}: ${type} chunk`);
    if (type === "eXIf") {
      const body = buf.toString("latin1", off + 8, off + 8 + len);
      if (/software|author|comment|parameters/i.test(body)) bad.push(`${file}: eXIf carries text`);
    }
    off += 12 + len;
    if (type === "IEND") break;
  }
}
walk(".");
if (bad.length) {
  console.error("privacy: image metadata:");
  for (const line of bad) console.error(line);
  process.exit(1);
}
' 2>&1; then
  status=1
fi

if [ "$check_history" -eq 1 ]; then
  allow="forge@local"
  [ -f .privacy-allow ] && allow="$(tr '\n' ' ' < .privacy-allow)"
  while read -r email; do
    [ -z "$email" ] && continue
    case " $allow " in
      *" $email "*) ;;
      *)
        # GitHub's noreply alias is derived from the public account name and is
        # meant to be public; a real mailbox is what this gate is for.
        if [[ "$email" =~ ^[0-9]+\+[A-Za-z0-9_-]+@users\.noreply\.github\.com$ ]]; then
          echo "privacy: public noreply alias in history, allowed by design: $email"
        else
          echo "privacy: commit identity not allowed: $email"
          echo "         rewrite history (git filter-repo) or list it in .privacy-allow"
          status=1
        fi
        ;;
    esac
  done < <(git log --format='%ae' | sort -u)
fi

if [ "$status" -eq 0 ]; then echo "privacy: clean"; fi
exit "$status"
