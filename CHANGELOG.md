# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Host-neutral core (`core/contract.mjs`, `core/profile.mjs`, `core/prompt.mjs`, `core/compile.mjs`, `core/executor.mjs`, `core/verify.mjs`, `core/capabilities.mjs`) with machine-independent plan IDs and byte-exact rollback.
- Six profiles: `dsh`, `claude-code`, `codex`, `gemini`, `opencode`, `generic`; model overlays under `models/` and `prompt/models/`.
- Managed Markdown blocks, JSON merge and root-table-aware TOML key replacement; `compile`, `plans`, `verify-plan`, `revert-plan`, `profiles`, `hosts`, `models` CLI commands.
- Transactional apply with per-file backups, `beforeSha`/`afterSha`, drift refusal, symlink preflight checks, and DSH patch delegation/verification.
- Windows host candidate paths and `--host-root` override; `planId` excludes absolute paths so the same profile compiles identically across machines.

### Changed

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
