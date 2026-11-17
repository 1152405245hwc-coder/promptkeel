# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Cross-Host `replace-full` (`B4`) Delivery & Dynamic Verification**:
  Implemented `mergeYaml` (`yaml-merge`) and executable `0755` `write-shim` actions in `core/executor.mjs`, `core/compile.mjs`, and `core/shim.mjs`; updated `codex` (`.codex/config.toml` `model_instructions_file`), `gemini` (`.gemini/system.md` + `GEMINI_SYSTEM_MD` shim), `continue` (`.continue/config.yaml` `chatOptions.baseAgentSystemMessage`), and `claude-code` (`--append-system-prompt-file` shim). Updated `core/grades.mjs` to derive `replace-full` vs `append-only` dynamically from compiled actions.
- **First-Class Strategy & Gateway Modules (`core/strategy.mjs`, `core/gateway.mjs`, `core/index.mjs`)**:
  Elevated `variable` wrap, `crescendo`/`deep`/`layered` multi-turn refinement, `prefill`, and `stuffContext` context dilution out of `scripts/live_matrix.mjs` into `core/strategy.mjs` and `core/gateway.mjs`, adding `dsh-forge run`, `dsh-forge strategies`, built-in Anthropic/GLM/Magpie presets, and fixing multi-turn assistant reply capture.
- **Expanded DSH `0.2.2-rc.3` Patch Surface & Opt-In Session Cleaning (`lib/table.mjs`, `lib/inject.mjs`, `lib/index.js`)**:
  Expanded verified anchors from 16 to 23 patches (18 files across 17 `@deepseek-ai/*` packages) spanning all 5 layers (`approval` 7, `sandbox` 9, `turn` 1, `persona` 4, `session` 2) plus opt-in `cleanSessionHistory` filtering on `session/deriveMessages` and fixture-capable session detectors in `hosts/evidence.mjs`.
- **Interactive Local Workbench & Upgraded Sidebar (`ui/tokens.mjs`, `ui/workbench.js`, `core/console.mjs`, `client/src/entry.js`)**:
  Shared design tokens, `/workbench`, `/plans`, `/live`, CSRF-protected `POST /api/*` routes under strict `script-src 'self'` CSP, and added the interactive `工作台` (Studio) tab to the DSH sidebar panel.
- **Unified State Root & Docs Tooling**:
  Unified `defaultStateRoot()` via `DSH_FORGE_STATE` -> `$XDG_STATE_HOME/dsh-forge` -> `~/.dsh-forge` (isolating workspace plans/snapshots from `~/.dsh/`), folded redundant micro-files (`verify.mjs`, `profile.mjs`, `context.mjs`) into core owners, rewrote `README.zh-CN.md` in Simplified Chinese, added `docs/RELATED_PROJECTS.md` and `docs/TASKS.md`, and extended `scripts/check_docs.mjs`.

### Previous Milestones

### Added

- `--ladder` on the live matrix: four rungs (direct, persona, cipher, prefill) so each model
  records which lever it answers to, plus `docs/PLAYBOOK.md` with the measured readings.
- `docs/research/JAILBREAK_PRINCIPLES.md`: where refusals come from, the six levers that move
  them, and what this harness can and cannot claim.
- Assistant prefill support in the request builder (`prefill` becomes an assistant turn).


### Added
- Live matrix reaches a local gateway: `--gateway <url|default>` targets an OpenAI-compatible
  endpoint that needs no key, `--list-models` prints what it advertises, and prefixed ids
  (`codex/gpt-6-luna`, `commandcode/deepseek/deepseek-v4-pro`) resolve to the right forge model.
  `--control` adds a prompt-free arm per model and probe so every forge cell has a baseline.
- Report separates four outcomes instead of two: `refused`, `blocked` (provider filter answered
  before the model ran), `empty` (a 200 with no text) and `compliant` (a non-refusal with code,
  steps or prose). Refusal detection gained the phrase shapes that were slipping through
  (`我不会写`, `不能执行`, `不提供替代`, `拒绝生成`, `做不了`).
- Persona `unfiltered`: treats the request as already reviewed and keeps the answer in the
  requested form without restating policy or swapping in an adjacent topic.
- Hosts `hermes`, `openclaw` and `muse`: profile targets for `~/.hermes/SOUL.md`,
  `~/.kimi_openclaw/workspace/AGENTS.md` and a prompt-only pass-through, with grades
  `replace-with-residue`, `append-only` and `unobservable`. Preflight now asks for rollback
  only when a profile has a mutating target.

- Payload transforms: `core/transform.mjs` implements `base64`, `rot13`, `leet`, `vowels`, `morse`, `ascii`, `reverse` and `split` with a decode path for every reversible kind. Personas declare one in frontmatter with an optional plaintext `lead`; `compile --transform <kind>` encodes the whole composed prompt. `dsh-forge transforms` prints round-trip status and expansion per kind.
- Probe harness: `dsh-forge probe [profile] [--persona <id>] [--transform <kind>]` runs eighteen worst-case requests across ten families and measures `active`, `carry`, `identity`, `scaffold`, `budget`, `loader` and `residue` on the composed prompt without calling a model. `selfCheck()` feeds a poisoned prompt through the same path and requires it to fail, so `probe` exits non-zero when the harness stops discriminating.
- Persona library reaches ten entries, covering the technique families a static prompt can express: `roleplay`, `nested`, `code`, `fewshot`, `cipher` (base64 in frontmatter) and `split` (48-column wrapping).

- Sidebar gains `Grades` and `Personas` tabs, fed by `grades` and `personas` in the panel's `/status` payload.
- Console and sidebar now share one design system: sticky brand bar with route pills, metric cards with progress meters, semantic status chips, zebra tables, print styles, and a narrow-column layout for the sidebar.


- Session-layer patch `session-reference-warning-neutral`: cross-session references are re-framed as current task context instead of untrusted snapshots, so earlier instructions and permission decisions carried across sessions are no longer silently demoted. The patch table now covers all five armor layers (`approval` 5, `sandbox` 6, `turn` 1, `persona` 3, `session` 1).

- Operation audit: `dsh-forge audit [--limit 100]` reads every daily log file, counts events per type, and reports unreadable lines instead of dropping them. `snapshot.written` and `console.start` are now recorded.
- Snapshots: `dsh-forge snapshot [profile]` stores the composed prompt under `<state>/snapshots/` with UTC-stamped names, then prunes by age (7 days), count (5), and total size (200 MiB), always keeping the newest file. `--list` and `--json` report what is stored.

- Read-only console: `dsh-forge console [--port 7788] [--state <dir>]` serves doctor checks, patch layers, channel counts, delivery grades and personas on `127.0.0.1`, with `/api/state` as JSON and `--once` for a printed overview. `core/console.mjs` keeps a single instance per state directory through `console.pid`, answers `405` to non-`GET` requests, and renders state-builder failures into the response.

- Slash channel is real: a `command` target kind renders a markdown command file with frontmatter, and the `claude-code` profile now delivers `.claude/commands/dsh-forge.md`.
- Delivery grades: `core/grades.mjs` records `replace-full` / `replace-with-residue` / `append-only` / `shim-only` / `unobservable` per host with its mechanism and source, `plan.delivery` carries the grade, and `dsh-forge grades` prints the table.
- Channel model: `core/channels.mjs` classifies every compiled action as `project` / `install` / `shim` / `slash` / `none` with an effect timing, `plan.channels` carries the summary, and `dsh-forge channels [--all]` prints one profile or the whole matrix. `core/shim.mjs` plus `dsh-forge shim` render a deterministic POSIX wrapper that exports the prompt and execs the host binary.
- Persona layer: `core/persona.mjs`, three bundled personas (`direct`, `engineer`, `tutor`), `dsh-forge personas`, and `--persona` / `--persona-mode` on `compile`. Modes are `replace`, `strict`, `append`, `off`; `off` reproduces the plain composition byte for byte.
- Five more breakage patches (15 total): sandbox escalation hint no longer promises an approval prompt, seatbelt blanket write deny removed, filesystem fence branches removed, badge skill description neutral, deliverable guidance no longer forbids `present`. Every entry now carries a `layer` (`approval` / `sandbox` / `turn` / `persona`).
- Two more breakage patches: `sandbox-policy-brand-neutral` (policy lines stop naming the host product) and `harness-identity-off` (stock self-description section is not injected). Both anchors verified against DSH 0.2.2-rc.3.
- Research notes for the next phases: `docs/research/BREAKOUT_PATCH_MATRIX.md` (90 patch names from six dsh-purge forks graded by portability), `docs/research/PERSONA_CHANNEL_DESIGN.md` (four modes, persona layout, four channels), `docs/research/PLATFORM_BREAKOUT_MATRIX.md` (support grades for ten hosts).
- Host-neutral core (`core/contract.mjs`, `core/profile.mjs`, `core/prompt.mjs`, `core/compile.mjs`, `core/executor.mjs`, `core/verify.mjs`, `core/capabilities.mjs`) with machine-independent plan IDs and byte-exact rollback.
- Six profiles: `dsh`, `claude-code`, `codex`, `gemini`, `opencode`, `generic`; model overlays under `models/` and `prompt/models/`.
- Managed Markdown blocks, JSON merge and root-table-aware TOML key replacement; `compile`, `plans`, `verify-plan`, `revert-plan`, `profiles`, `hosts`, `models` CLI commands.
- Transactional apply with per-file backups, `beforeSha`/`afterSha`, drift refusal, symlink preflight checks, and DSH patch delegation/verification.
- Windows host candidate paths and `--host-root` override; `planId` excludes absolute paths so the same profile compiles identically across machines.

### Changed

- Core compilation no longer imports DSH patch/ASAR runtime modules directly; DSH actions use an explicit synchronous provider bridge.
- Activation evidence now rejects `active` without session/runtime proof and treats generic or unobservable hosts explicitly.
- Batch application is experimental and opt-in; serialized target metadata, preview requirements, replay guards, and state-key isolation prevent silent empty applies.
- Host support now uses a normalized adapter registry and includes Cursor, Windsurf, Aider, and Continue profiles; DSH remains one adapter with its native patch provider.
- Added `compileMany()`/`applyBatch()` for deterministic multi-platform plans, target conflict detection, batch previews, locks, and compensation rollback.
- `doctor` and `status --json` now report configuration, host readiness, session loading, and restart requirements as separate activation fields.
- Privacy checks ignore the local `.dsh-forge-state/` plan ledger, which is runtime state and is now excluded from Git.
- Profiles now expose risk, host mutation, restart, and activation-evidence metadata; existing high-permission behavior remains unchanged.
- CI runs on Node 20 and 22 with a reproducible npm lockfile and repository quality gate.

### Fixed

- Prompt section tests no longer depend on an incidental `AGENTS.md` in the checkout.
- `injectionSource` only recognizes an `AGENTS.md` that contains a dsh-forge managed block.
- Cross-host applies can persist a `forge.preview/v1` file and refuse to overwrite files whose SHA-256 changed after preview.

## [0.1.0] - 2026-11-14

### Added

- Prompt composition pipeline (`prompt/core.md`, adapters, modes) with token budget check and sha256 header.
- Declarative host patch engine (`lib/engine.mjs`, `lib/table.mjs`) with version range gates, per-version `variants` support, preflight dry-run, atomic writes, and manifest-based revert.
- Upgrade workflow (`dsh-forge upgrade`) and host-version mismatch guard on `revert`.
- Profile bundle management (`dsh-forge profile status|enable|disable`) with automatic bundle ordering after `dsh-purge*`.
- `dsh-forge doctor` (12 host and configuration checks) and `dsh-forge verify` (patch markers, prompt budget, session log).
- Sidebar management panel (`client/src/entry.js`) with overview, patches, prompt, policy, and log views.
- Optional weight-level abliteration script (`tools/abliterate`) and refusal evaluation script (`tools/eval`).
- Loopback API security checks (`Host`, `Origin`, `Sec-Fetch-Site`, 256 KB JSON body limit), privacy scanner, and CI workflow.
