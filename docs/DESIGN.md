# Design Notes

## Why dsh-forge Exists

Agent harnesses (DeepSeek Harness, Claude Code, Codex CLI, Gemini CLI, OpenCode) combine three runtime surfaces:
1. **System and workspace prompt instructions**
2. **Tool approval and permission gates**
3. **Filesystem and command sandbox defaults**

Earlier community patch bundles modified 80+ minified strings across UI components, bundled 650+ KB of frontend assets, and registered duplicate tool names that conflicted when multiple plugins coexisted in a profile. Every minor host update broke dozens of brittle UI anchors.

`dsh-forge` narrows the design to the minimum verifiable surface and separates host-neutral compilation (`core/`) from DSH-specific runtime patching (`lib/`).

## Key Engineering Decisions

| Decision | Trade-off and Rationale |
|---|---|
| **8 core patches with versioned `variants` (`lib/table.mjs`)** | Only approval defaults, sandbox escalation checks, default sandbox mode, and workspace instruction precedence are patched (5 files across 4 `@deepseek-ai/*` packages). UI-cosmetic patches are omitted so minor DSH updates rarely break anchors; when an anchor does change, version-scoped `variants` keep backward compatibility. |
| **Pure compiler vs. transactional executor (`core/compile.mjs`, `core/executor.mjs`)** | Compilation is a pure function from `(profile, model, mode)` to a deterministic `planId` and action list. No host file is inspected or touched until the executor runs with `--yes`, making plans reproducible across machines and testable in isolation. |
| **Manifest backups with `sha256` and host-version guards** | Every write backs up original file bytes and records `beforeSha`, `afterSha`, and `hostVersion`. `revert` and `revert-plan` verify post-apply hashes before restoring, refusing to overwrite files edited after apply or backups taken from an older DSH build unless `--force` is explicit. |
| **Coexistence via declarative node suppression (`cordis.patch.yml`)** | When installed alongside legacy `dsh-purge` bundles, `dsh-forge` orders itself after them in `dsh.profile.bundles` and disables conflicting plugin nodes so only one `systemPrompt` section (`forge:prompt`) is registered. |
| **Token-budgeted modular prompt (`prompt/`)** | Prompts are composed deterministically from `core + model/adapter + host + mode` layers (693 tokens default for DSH, ~680–766 tokens across cross-host profiles) and checked against a 3,200-token cap so system context is not bloated. |
| **Zero-dependency 15 KB sidebar panel (`client/src/entry.js`)** | Written directly with `React.createElement` and wrapped by `scripts/build-client.mjs` without external bundlers, keeping the client artifact small and auditable. |

## Out of Scope

- Built-in package managers or background auto-updaters (handled by `pnpm` and `dsh-forge upgrade`).
- Patching minified JavaScript on non-DSH harnesses (Claude Code, Codex, Gemini, and OpenCode profiles write only to documented Markdown, JSON, and TOML configuration files).
- Modifying base model weights by default (`tools/abliterate/` is strictly an opt-in local script for open-weight models).
