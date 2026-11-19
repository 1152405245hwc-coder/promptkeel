# Engineering Rules (Anti-Regression Guardrails)

Each rule below encodes a class of bug or rework that the repository already paid for in git history or the `0.2.0` audit.

## 1. No Transport or Session Change Without an HTTP Fixture E2E Test

Pure unit tests on `buildTurn()`, `repackTurn()`, or `placeSystem()` do not prove the wire loop works. In `0.2.0`, unit tests were 100% green while `sendTurn()` read a nonexistent `response.code` field and `systemVariants()` re-injected the system prompt into `bare` shape.

- **Requirement:** Any change to `core/session.mjs`, `scripts/session.mjs`, `core/gateway.mjs`, or `scripts/live_matrix.mjs` request packing/degradation must add or update an in-process `http.createServer` test in `test/session-e2e.test.mjs` asserting the exact JSON request body received on the wire.

## 2. Evaluation Outputs Must Stamp `classifierHash`, `systemMode`, and Separate Proxy Blocks

Refusal classifiers evolve (`cd4db48` retracted a `2.5x` claim once the classifier changed), and free-pool proxies return `HTTP 200` SSE IP-block notices (`chatcmpl-freeipblk...`) or guard banners (`[magpie/*]`) that look like model replies if unchecked.

- **Requirement:**
  - `makeRow()`, `live_matrix.mjs` reports, and `session` turn/export records must carry `classifierHash()`.
  - Gateway responses carrying `chatcmpl-freeipblk*` or `[magpie/*]` must resolve to `status: "upstream_error"` and `verdict: "blocked"`, never `"ok"` or `"delivered"`.
  - Follow all eight rules in [MEASUREMENT_RULES.md](MEASUREMENT_RULES.md) before publishing any comparison table.

## 3. Verified Primary Hosts Require Golden Detection Fixtures

False-positive host detection (`b0daf96`, where `.dsh-market/discovery.json` triggered `active` status) happens when detectors are tested only against ad-hoc local folders.

- **Requirement:** Every host marked `"support": "verified"` (`dsh`, `claude-code`, `codex`, `opencode`) must keep synthetic golden fixtures under `test/fixtures/hosts/<host>/` verified by `test/host-fixtures.test.mjs` for `missing`, `configured`, `active`, and known false-positive traps.

## 4. Single-Concern Sliced Commits & Clean Tree Before Release

Giant mixed commits (`c12f0d3`: 64 files; un-sliced worktrees) slow review and break `git bisect`.

- **Requirement:**
  - Commit by coherent concern (security/gateway fixes vs. session engine vs. CLI refactoring vs. package rename vs. docs/tests).
  - Run all release gates (`npm test`, `npm run check:repo`, `npm run docs:check`, `npm run verify:profiles`, `npm run verify`, `npm run release:check`) on a clean index before tagging.
  - Never record personal home paths, email addresses other than the repo identity (`forge@local`), UUIDs, or credential prefixes anywhere in tracked or untracked files (`scripts/privacy_scan.sh --history` enforces this).
