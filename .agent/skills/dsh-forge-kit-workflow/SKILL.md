---
name: dsh-forge-kit-workflow
description: Pre-commit slicing, HTTP fixture E2E verification, anti-contamination live-evaluation, and 5-gate release workflow for dsh-forge-kit.
---

# `dsh-forge-kit` Engineering & Release Workflow

Follow this checklist for every feature, fix, live evaluation, or release in `dsh-forge-kit`.

## 1. Change & Commit Slicing

1. Keep `core/` free of `lib/` imports (`scripts/check_repo.sh` enforces this).
2. Keep every compiled profile under the 480-token prompt ceiling (`npm run verify:profiles`).
3. Slice changes into single-concern commits (e.g., gateway/security, session/transport, CLI refactor, host fixtures, docs) instead of bundling unrelated subsystems.
4. Never write absolute user paths, personal emails, UUIDs, or token strings into source, fixtures, tests, or docs.

## 2. Mandatory E2E & Golden Fixture Gates

- **Session / Transport / Matrix changes:** Run and extend `test/session-e2e.test.mjs` using real in-process `http.createServer` endpoints covering:
  - System-slot HTTP rejections (`400`/`422`) degrading `full -> inline`
  - Multi-message / lock rejections degrading `history -> single -> bare` (exact bare payload on the wire)
  - Proxy block payloads (`chatcmpl-freeipblk*`, `[magpie/*]`) classified as `upstream_error` / `blocked`
  - Parity between `live_matrix.mjs --dry-run --dump-request` and live requests
- **Primary Host (`dsh`, `claude-code`, `codex`, `opencode`) changes:** Update `test/fixtures/hosts/<host>/` and verify `test/host-fixtures.test.mjs` distinguishes `missing`, `installed`, `configured`, `active`, and false positives.

## 3. Anti-Contamination Live Evaluation Checklist

Before claiming any live matrix or session stability result:

1. Sample `n >= 3` per cell and interleave compared strategies (`--compare a,b`).
2. Confirm `classifierVersion`, `classifierHash`, and `systemMode` are stamped in the output JSON.
3. Check `responseId` / error fields and discard batches hit by `chatcmpl-freeipblk` or proxy throttling.
4. Separate `refused`, `blocked`, `empty`, and `delivered` verdicts; retry reasoning starvation (`finish_reason=length` / `HTTP 502`).
5. Include the exact reproduction command block (`docs/MEASUREMENT_RULES.md`).

## 4. Release Verification Sequence

If `client/src/entry.js` changed, run `npm run build:client` first. If `lib/table.mjs`, `profiles/`, or `models/` counts changed, run `node scripts/check_docs.mjs`. Then execute all gates in order:

```bash
npm test
npm run check:repo
npm run docs:check
npm run verify:profiles
npm run verify
npm run release:check
```

Confirm `git status` is clean before creating any release tag.
