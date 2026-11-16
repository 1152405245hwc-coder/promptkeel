# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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
