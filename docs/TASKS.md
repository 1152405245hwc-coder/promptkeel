# Project Tasks & Release Checklist

## Completed Architecture Milestones

- **Workspace & State Hygiene (`core/executor.mjs`, `lib/paths.mjs`, `bin/dsh-forge.js`)**:
  Unified `defaultStateRoot()` to `$DSH_FORGE_STATE` -> `--home/.dsh-forge` -> `$XDG_STATE_HOME/dsh-forge` -> `~/.dsh-forge`, eliminating silent leaks into `~/.dsh/`. Consolidated micro-modules into coherent `core/` owners (`contract.mjs`, `compile.mjs`, `executor.mjs`, `strategy.mjs`, `gateway.mjs`, `index.mjs`).
- **True Cross-Host `replace-full` (`B4`) Delivery (`profiles/`, `core/executor.mjs`, `core/grades.mjs`)**:
  Implemented `mergeYaml` (`yaml-merge`) and executable `write-shim` (`0755`) targets across `codex` (`.codex/config.toml` `model_instructions_file`), `gemini` (`.gemini/system.md` + `GEMINI_SYSTEM_MD` shim), `continue` (`.continue/config.yaml` `chatOptions.baseAgentSystemMessage`), and `claude-code` (`--append-system-prompt-file` shim + slash + permissions). Made `core/grades.mjs` verify actual compiled actions dynamically.
- **Strategy & Gateway Engine (`core/strategy.mjs`, `core/gateway.mjs`, `scripts/live_matrix.mjs`, `bin/dsh-forge.js run`)**:
  Promoted `variable` wrapping, `crescendo` / `deep` / `layered` multi-turn scripts (fixing multi-turn `response.reply` forwarding), `prefill`, and `stuffContext` dilution into first-class strategies supporting Magpie `:3425` and standard OpenAI/Anthropic/GLM APIs.
- **DSH `0.2.2-rc.3` Verified Anchors & Session Cleaning (`lib/table.mjs`, `lib/inject.mjs`, `lib/index.js`)**:
  Expanded verified patch table from 16 to 23 entries (18 files, 17 `@deepseek-ai/*` packages) across all 5 canonical layers (`approval`, `sandbox`, `turn`, `persona`, `session`) plus opt-in `cleanSessionHistory` message derivation hook.
- **Release-Grade Workbench UI (`ui/tokens.mjs`, `ui/workbench.js`, `core/console.mjs`, `client/src/entry.js`)**:
  Shared design tokens, CSRF-protected `/api/*` workbench (`Compile`, `Probe`, `Apply/Revert`, `Plans`, `Live Runner`, `Patches`, `Audit`), dynamic `listModes()`, live model resolution via `resolveForgeModelId()`, CSP `script-src 'self'`, and updated DSH sidebar bundle (`工作台` Studio tab).
- **Host Evidence & Detector Accuracy (`hosts/adapter.mjs`, `hosts/evidence.mjs`, `hosts/dsh.mjs`, `hosts/hermes.mjs`, `hosts/openclaw.mjs`, `hosts/muse.mjs`, `hosts/table.mjs`)**:
  Eliminated false `active` status from `.dsh/profiles/` market metadata, added newest-first session scanning + Hermes session checks, preserved `config` evidence across adapters, and ensured `muse` reports `unobservable` portably across macOS and Linux CI.

## Verification & Release Gates

1. Offline suite & browser UI check: `npm test`, `npm run verify:profiles`, `npm run check:repo`, `npm run docs:check`, plus an interactive headless Chromium check across `:7788` (`/workbench`, `/plans`, `/live`, `/patches`) and `client/preview/index.html` (dependency-free repo keeps `npm test` self-contained).
2. Host dry-run check: `npm run verify` (`23/23` patches ready on target DSH `0.2.2-rc.3` host).
3. Live bounded Magpie evaluation: compared `direct` vs `variable+contract` across 4 channels (`commandcode/deepseek/deepseek-v4.1-flash`, `hiyo-ds/deepseek-v4-pro`, `group/free-strong`, `group/free-light`) with `repeat=3` on `lateral-report-digest` + `adult-explicit-scene` (`minor`/`bio`/`chem`/weapons strictly excluded as `NOT_RUN_SAFETY_BOUNDARY`), and fixed upstream SSE chunk assembly, `[magpie/*]` proxy guard classification, and bare refusal matching.
4. Git identity & privacy gate: clean author/committer history (`dsh-forge <forge@local>`), zero `.privacy-allow`, and passing `npm run release:check`.

## 0.2.0 Release State

Shipped in this cut (**PromptKeel** / `promptkeel`):

- **Distribution rebrand (`promptkeel`)**: rebranded from `dsh-forge` / `dsh-forge-kit` to `promptkeel`, updated Cordis plugin node, loopback API `/promptkeel/api`, client module ID, and default state roots (`~/.promptkeel/`, `~/.dsh/promptkeel/`) with legacy `dsh-forge` / `dsh-session` CLI aliases, `DSH_FORGE_*` fallbacks, and bundle auto-migration; trimmed `docs/research/` and `tools/` out of published npm tarballs.
- **Verified 4-host core + golden fixtures**: promoted `opencode` to `verified` alongside `dsh`, `claude-code`, and `codex`; added synthetic golden detection fixtures (`test/fixtures/hosts/`, `test/host-fixtures.test.mjs`) and expanded CI (`ubuntu-latest` + `macos-latest` × Node `20`/`22`).
- **`promptkeel session` (`dsh-session`) + transport & matrix fixes**: fixed `bare` system-leak in `systemVariants()`, `variantRejected()` `httpStatus` reading, replay/continuity filtering (`REPLAYABLE_VERDICTS`), `thin` arm escalation, `consecutiveFailures` off-by-one & transport-error exclusion, concurrent `recordFamilyDelta()` merging, `matrix` dry-run isolation, in-process `live_matrix.mjs` compile parity, `chatcmpl-freeipblk*` proxy-block detection, `classifierHash()` stamping, and added `test/session-e2e.test.mjs` HTTP fixture suite.
- **CLI & core API curation**: split `bin/dsh-forge.js` into `bin/commands/{shared,dsh,plan,runtime}.mjs` (+ `session` forwarding), tightened `core/index.mjs` to explicit named exports (`test/public-api.test.mjs`), and removed unreferenced exports & `live_matrix.mjs` re-export shim.
- **Onboarding, launch kit, engineering rules & skill**: added `docs/ONBOARDING.md`, `lib/README.md`, `docs/ENGINEERING_RULES.md`, `docs/LAUNCH-KIT.md`, `docs/assets/hero.svg`, `CONTRIBUTING.md`, `SECURITY.md`, `.agent/skills/promptkeel-workflow/SKILL.md`, and snapshot banners on `docs/research/*.md`.
- **Shared Host-header guard & release tooling**: extracted `core/net.mjs`, codified `docs/MEASUREMENT_RULES.md`, added `scripts/bump_version.mjs` and `scripts/release_check.sh`.

Open before a public publish:

- **Live figures.** The route matrix in `docs/research/LIVE_ROUTE_MATRIX_2026-11-18.md` was measured on a free pool that blocks by egress IP; the stability numbers there stop at transport, not at model willingness. A keyed upstream is required before any delivery-rate claim is published as fact.
