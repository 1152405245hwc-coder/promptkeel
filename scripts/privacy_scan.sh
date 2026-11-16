#!/usr/bin/env bash
# Fail if the repository contains obvious private data or credentials.
set -euo pipefail
cd "$(dirname "$0")/.."

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
  'password[[:space:]]*[:=][[:space:]]*[^[:space:]]+'
  'Bearer[[:space:]]+[A-Za-z0-9._-]{20,}'
  'ds-[A-Za-z0-9]{20,}'
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
)

status=0
for p in "${patterns[@]}"; do
  if grep -RInE \
    --exclude-dir=.git \
    --exclude-dir=node_modules \
    --exclude-dir=fixtures \
    --exclude-dir=.dsh-forge-state \
    --exclude=privacy_scan.sh \
    "$p" . >/tmp/forge-privacy.$$ 2>/dev/null; then
    echo "privacy: matched pattern: $p"
    sed -n '1,5p' /tmp/forge-privacy.$$
    status=1
  fi
done
rm -f /tmp/forge-privacy.$$
if [ "$status" -eq 0 ]; then echo "privacy: clean"; fi
exit "$status"
