# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Host-neutral core (`core/contract.mjs`, `core/profile.mjs`, `core/prompt.mjs`, `core/compile.mjs`, `core/executor.mjs`, `core/verify.mjs`, `core/capabilities.mjs`) with machine-independent plan IDs and byte-exact rollback.
- Six profiles: `dsh`, `claude-code`, `codex`, `gemini`, `opencode`, `generic`; model overlays under `models/` and `prompt/models/`.
- Managed Markdown blocks, JSON merge and root-table-aware TOML key replacement; `compile`, `plans`, `verify-plan`, `revert-plan`, `profiles`, `hosts`, `models` CLI commands.
- Transactional apply with per-file backups, `beforeSha`/`afterSha`, drift refusal, symlink preflight checks, and DSH patch delegation/verification.
- Windows host candidate paths and `--host-root` override; `planId` excludes absolute paths so the same profile compiles identically across machines.

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
