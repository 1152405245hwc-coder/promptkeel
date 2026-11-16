# dsh-forge

[中文文档](README.zh-CN.md)

[![CI](https://img.shields.io/badge/CI-Node%2020+-000?style=flat-square)](#verification--quality-gate)
[![License: MIT](https://img.shields.io/badge/License-MIT-000?style=flat-square)](LICENSE)
[![Runtime Dependencies: 0](https://img.shields.io/badge/Runtime%20Deps-0-000?style=flat-square)](package.json)

**Prompt injection, declarative host patches, and a deterministic multi-platform profile compiler for DeepSeek Harness (DSH), Claude Code, Codex CLI, Gemini CLI, OpenCode, Cursor, Windsurf, Aider, Continue, and local open-weight runtimes.**

```text
┌────────────┐   compose    ┌──────────────┐   section    ┌───────────────┐
│ prompt/    │ ───────────▶ │ lib/inject   │ ───────────▶ │ DSH system    │
│ core+mode  │              │ budget+hash  │              │ (forge:prompt)│
└────────────┘              └──────────────┘              └───────────────┘
┌────────────┐   dry-run    ┌──────────────┐   backup     ┌───────────────┐
│ table.mjs  │ ───────────▶ │ lib/engine   │ ───────────▶ │ host files &  │
│ 15 patches  │              │ verify+apply │              │ manifest      │
└────────────┘              └──────────────┘              └───────────────┘
```

![dsh-forge panel](docs/ui-preview.png)

---

## Why `dsh-forge`

| Dimension | Legacy Community Patch Bundles | `dsh-forge` Engineering Approach |
| :--- | :--- | :--- |
| **Host Patch Surface** | 80+ brittle UI & runtime string replacements that break on minor host updates | **8 version-gated patches** across 5 `@deepseek-ai/*` files with per-version `variants` support |
| **Prompt Composition** | Monolithic hardcoded prompt or ad-hoc session file edits | Modular `core + model/adapter + host + mode` pipeline (~693 tokens default), `<= 3200` token gate, and `sha256` header |
| **Verification** | Visual status badge only | 3-stage proof check (`proof1-patches`, `proof2-prompt`, `proof3-session` on `session.v4.jsonl.zstd`) + 12-check `doctor` |
| **Control Panel** | 650+ KB external bundle | **15 KB dependency-free sidebar bundle** (`Overview`, `Patches`, `Prompt`, `Policy`, `Logs`) |
| **Backup & Rollback** | Single `.bak` file overwritten on re-run | Timestamped `manifest.json` + original file `sha256` + `hostVersion` guard + symlink refusal (`lstatSync`) |
| **Cross-Host Portability** | Locked to a single host | Adapter registry + pure compiler + transactional executor across 10 host profiles |

---

## Project Architecture & Directory Structure

`dsh-forge` is structured into two decoupled execution layers sharing a single CLI and modular prompt corpus:

1. **Cross-Host Compiler & Transactional Executor (`core/`, `hosts/`, `profiles/`, `models/`)**: Validates schemas, composes layered prompts, compiles deterministic `planId` execution plans, and applies/verifies/reverts changes across documented host configuration files.
2. **DeepSeek Harness Native Engine (`lib/`, `client/`)**: Inspects and unpacks `app.asar` when needed, applies the 8 version-gated host patches (`lib/table.mjs`), registers the `forge:prompt` section via Cordis, and serves the loopback `/dsh-forge/api` control surface.

```text
dsh-forge/
├── bin/
│   └── dsh-forge.js        # Unified CLI entry point (DSH native + cross-host commands)
├── core/                   # Host-neutral compiler & transactional executor
│   ├── contract.mjs        # Schema validation & loaders for profiles/*.json and models/*.json
│   ├── capabilities.mjs    # Capability matrix (prompt, approval, sandbox, tools, rollback) & preflight
│   ├── prompt.mjs          # Deterministic multi-layer prompt renderer & CJK-aware token estimator
│   ├── compile.mjs         # Pure compiler: (profile, model, mode) -> machine-independent plan
│   ├── executor.mjs        # Transactional writer (mergeBlock, mergeJson, mergeToml, backups, rollback)
│   ├── batch.mjs           # Multi-platform batch compile/apply and compensation rollback
│   ├── verify.mjs          # Internal plan hash check & post-apply target verification
│   ├── profile.mjs         # Public re-export facade for contract primitives
│   └── errors.mjs          # Structured ForgeError with stable machine-readable error codes
├── hosts/                  # Per-host environment detectors & configuration target descriptors
│   ├── registry.mjs        # Host catalog (detectHost, detectAll)
│   └── *.mjs               # dsh, claude-code, codex, gemini, opencode, generic, cursor, windsurf, aider, continue
├── profiles/               # Declarative target profiles for the ten registered adapters
├── models/                 # Model family metadata & overlay bindings (deepseek, claude, gpt, gemini, qwen, local)
├── prompt/                 # Modular prompt sources
│   ├── core.md             # Base execution rubric (routing, boundary handling, A-D evidence grading)
│   ├── adapters/           # DSH runtime adapters (deepseek, generic)
│   ├── hosts/              # Per-host operational overlays
│   ├── models/             # Per-model-family behavioral overlays
│   └── modes/              # Task-specific overlays (coding, research, writing)
├── lib/                    # DSH-native runtime, ASAR unpacker, patch engine & Cordis plugin
│   ├── table.mjs           # 8 version-gated host patches (with per-version variants support)
│   ├── engine.mjs          # inspectPatch, dryRun, coalesced atomic apply, revert, upgrade
│   ├── asar.mjs            # Read-only app.asar header/file reader & atomic unpacker
│   ├── inject.mjs          # DSH prompt composition, budget check, session log proof verification
│   ├── doctor.mjs          # 12-point host, budget, conflict & bundle order inspection
│   ├── preset.mjs          # Workspace policy (strict/fallback/always) & profile bundle ordering
│   ├── paths.mjs           # Path resolution, path redaction, symlink guard & atomic file helpers
│   ├── log.mjs             # Daily JSONL event logger
│   └── index.js            # Cordis plugin entry, /forge slash command & loopback /dsh-forge/api
├── client/                 # DSH sidebar management UI
│   ├── src/entry.js        # Dependency-free React.createElement sidebar source
│   ├── client.js           # Built DSH module-loader bundle (generated by scripts/build-client.mjs)
│   └── preview/index.html  # Standalone static preview of the management panel
├── scripts/                # Build, profile verification, end-to-end verification & privacy scanner
├── tools/                  # Optional offline Python utilities (tools/abliterate, tools/eval)
├── test/                   # Node.js built-in test suite (core, engine, inject, security, api, asar, e2e)
└── docs/                   # Architecture, patch table, compatibility, debugging, design & portability guides
```

---

## Cross-Host Profiles

DSH is the native full-capability target. The same modular prompt and transactional rollback model compiles cleanly to other agent harnesses without modifying their minified runtime bundles:

| Host | Profile | Target Files Written | Support Level |
| :--- | :--- | :--- | :--- |
| **DSH (macOS / Linux / Windows)** | `dsh` | 8 JS patches (`@deepseek-ai/*`) + `~/.dsh/prompt-inject.md` | `verified` |
| **Claude Code** | `claude-code` | `CLAUDE.md` (managed block) + `.claude/settings.json` | `verified` |
| **Codex CLI** | `codex` | `AGENTS.md` (managed block, project only) | `verified` |
| **Gemini CLI** | `gemini` | `GEMINI.md` (managed block) + `.gemini/settings.json` | `experimental` |
| **OpenCode** | `opencode` | `AGENTS.md` (managed block) + `opencode.json` | `experimental` |
| **Cursor** | `cursor` | `.cursorrules` (legacy managed block) | `experimental` |
| **Windsurf** | `windsurf` | `.windsurfrules` (legacy managed block) | `experimental` |
| **Aider** | `aider` | `CONVENTIONS.md` (managed block) | `experimental` |
| **Continue** | `continue` | `.continue/rules/dsh-forge.md` (managed block) | `experimental` |
| **Generic API / Local Weights** | `generic` | System prompt payload only (`prompt-only`) | `experimental` |

```bash
# 1. Pure compile: inspect or export the execution plan without touching any host files
node bin/dsh-forge.js compile claude-code --model claude --mode coding --out /tmp/plan.json

# 2. Save a target preview (no disk writes without --yes)
node bin/dsh-forge.js apply --profile codex --dry-run --preview /tmp/forge-preview.json

# 3. Apply only if previewed files still have the same SHA-256 values
node bin/dsh-forge.js apply --profile codex --yes --preview /tmp/forge-preview.json
node bin/dsh-forge.js plans
node bin/dsh-forge.js verify-plan <plan-id>
node bin/dsh-forge.js revert-plan <plan-id>
```

Every profile is validated against `core/contract.mjs`. See [docs/PORTABILITY.md](docs/PORTABILITY.md) for the capability matrix and schema specification.

Profiles also declare `risk`, `mutatesHost`, `requiresRestart`, and `activationEvidence`. These fields describe operational impact and proof requirements; they do not silently change the existing high-permission behavior. Use `apply --dry-run --preview /tmp/forge-preview.json`, review the result, then pass the same file with `--yes` to reject files changed after the preview.

For multi-platform orchestration, `core/batch.mjs` exports `compileMany()` and an **experimental, opt-in** `applyBatch()`. Plans are sorted deterministically and conflicting writes are rejected. Batch writes require a persisted preview and explicit `allowExperimental: true`; there is no stable batch CLI or complete batch verify/revert lifecycle yet. The CLI single-profile commands remain the supported path.

---

## DeepSeek Harness (DSH) Installation & Workflow

```bash
# 1) Add dsh-forge to a DSH profile (desktop shown)
cd ~/.dsh/profiles/desktop
pnpm add /path/to/dsh-forge

# 2) Register dsh-forge in dsh.profile.bundles (automatically ordered after dsh-purge* with backup)
npx dsh-forge profile enable --profile desktop

# 3) Run the 12-check diagnostic, preflight, and apply the 8 host patches
npx dsh-forge doctor
npx dsh-forge apply --dry-run
npx dsh-forge apply --yes

# 4) Quit DSH completely (Cmd+Q), reopen, and verify all 3 runtime proofs
npx dsh-forge verify
```

### Coexistence with `dsh-purge`

When `dsh-purge-community` is installed in the same DSH profile, `dsh-forge` must appear *after* `dsh-purge-community` in `dsh.profile.bundles` (`dsh-forge profile enable` enforces this order automatically). `cordis.patch.yml` disables legacy `dsh-purge*` plugin nodes so only one `systemPrompt` section (`forge:prompt`) and one route table remain active.

The local HTTP control API mounts on DSH's loopback server under `/dsh-forge/api` and enforces strict `Host`, `Sec-Fetch-Site`, and `Origin` checks plus a 256 KB request body limit.

When `apply --yes` has to unpack `app.asar`, a failed patch or transaction restores the original packed archive. A successful apply intentionally leaves the host in its unpacked layout; reverting the managed patch files does not repack the application archive.

---

## Upgrading and Updating

### 1. Updating `dsh-forge`

After pulling a new revision or installing an updated tarball, `upgrade` reverts the active backup for the current host version and re-applies the current patch table:

```bash
cd ~/.dsh/profiles/desktop
pnpm add /path/to/dsh-forge
npx dsh-forge upgrade --dry-run
npx dsh-forge upgrade --yes
```

If `client/src/entry.js` was modified, run `npm run build:client` to regenerate `client/client.js`.

### 2. Recovering After a DSH Host Update

A DSH application update overwrites files under the application bundle. `revert` checks `manifest.hostVersion` against the installed DSH version and refuses to overwrite a newer DSH build with older backup files. After upgrading DSH:

```bash
# Check whether all 8 patch anchors still match the updated host
dsh-forge adapt

# If all 8 report ready, re-apply patches in one command
dsh-forge upgrade --yes

# If a patch reports miss, inspect the target file and add a versioned entry to variants in lib/table.mjs
dsh-forge explain <patch-id>
```

---

## Personas

`prompt/personas/*.md` holds prompt-level identity layers that travel across adapters. A persona composes with the host prompt in one of four modes: `replace` keeps host working rules while dropping identity claims, `strict` keeps the persona alone, `append` adds it after the host prompt, `off` disables it. `dsh-forge personas` lists what ships; `dsh-forge compile codex --persona engineer --persona-mode strict` selects one, and `off` reproduces the plain build byte for byte. Details in [docs/PERSONAS.md](docs/PERSONAS.md).

## CLI Reference

### DeepSeek Harness (`dsh`) Native Commands

| Command | Description |
| :--- | :--- |
| `dsh-forge doctor [--profile desktop\|web] [--json]` | Run 12 host, version, anchor, token budget, conflict, and profile bundle checks |
| `dsh-forge status [--profile desktop\|web] [--json]` | Print `doctor` report, active workspace policy, profile status, and backups |
| `dsh-forge apply [--dry-run\|--yes]` | Preflight or atomically apply the 8 host patches (automatically unpacks sealed `app.asar` on `--yes`) |
| `dsh-forge unpack [--dry-run\|--yes]` | Unpack sealed `Contents/Resources/app.asar` into `Contents/Resources/app` |
| `dsh-forge upgrade [--dry-run\|--yes]` | Revert same-version backup if present and re-apply the current patch table |
| `dsh-forge revert [--id <backup>] [--force]` | Restore host files from a backup manifest with `sha256` and `hostVersion` verification |
| `dsh-forge verify [--profile desktop\|web] [--json]` | Verify patch markers, prompt channel budget/registration, and newest session log |
| `dsh-forge adapt [--json]` | Check anchor readiness across all 15 patches after a DSH host update |
| `dsh-forge explain <patch-id>` | Print anchor match counts and target file preview for a specific patch |
| `dsh-forge profile [status\|enable\|disable] [--profile desktop]` | Inspect or update `dsh.profile.bundles` in `~/.dsh/profiles/<profile>/package.json` |
| `dsh-forge prompt compose [--adapter deepseek] [--mode coding] [--out file]` | Compose `core + adapter + mode` and validate against the token budget |
| `dsh-forge prompt install [--adapter deepseek] [--mode coding] [--home dir]` | Atomically write composed prompt to `~/.dsh/prompt-inject.md` (with backup) |
| `dsh-forge preset [strict\|fallback\|always]` | Get or set workspace prompt baseline coexistence policy |
| `dsh-forge log [--limit 50\|--clear]` | Read or clear structured JSONL logs under `~/.dsh/dsh-forge/logs/` |
| `dsh-forge collect` | Export a path-redacted diagnostics tarball (`~/.dsh/dsh-forge/reports/forge-diag-*.tar.gz`) |

### Cross-Host Compiler & Plan Commands

| Command | Description |
| :--- | :--- |
| `dsh-forge compile [profile] [--model <id>] [--mode <mode>] [--out file] [--json]` | Compile a cross-host execution plan without touching any files on disk |
| `dsh-forge apply --profile <id> [--model <id>] [--mode <mode>] [--preview file] [--dry-run\|--yes]` | Preview or transactionally apply a cross-host profile plan with optional SHA conflict protection |
| `dsh-forge plans [--json]` | List recorded execution plan manifests under `~/.dsh-forge/plans/` |
| `dsh-forge verify-plan <plan-id> [--json]` | Re-verify target file hashes and DSH patch markers for an applied plan |
| `dsh-forge revert-plan <plan-id> [--force]` | Byte-exact rollback of an applied plan (refuses drifted files unless `--force`) |
| `dsh-forge profiles [--json]` | List all validated profiles in `profiles/*.json` |
| `dsh-forge models [--json]` | List all validated model definitions in `models/*.json` |
| `dsh-forge hosts [--json]` | Detect local agent harness installations across all registered adapters |

`status --json` keeps activation state explicit: `doctor.activation.state` is `inactive`, `configured`, or `active`; `configured` means the prompt channel is written or registered, while `active` means a recent session has loaded the Forge header. `requiresRestart` is true when configuration is present but a new host session is still needed.

---

## Verification & Quality Gate

```bash
# Reproducible install and repository hygiene gate
npm ci --ignore-scripts
npm run check:repo

# Run unit, integration, security, ASAR, and HTTP API tests
npm test

# Smoke-compile and preflight all registered profiles
npm run verify:profiles

# Full verification suite (tests, profiles, client bundle, Python AST check, anchor drift, privacy scan)
npm run verify

# Scan tracked files for personal paths, tokens, handles, or private keys
npm run privacy:scan

# Audit npm package tarball contents
npm run pack:check
```

---

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Module layering, sequence diagrams, patch state machine, and cross-host compiler pipeline.
- **[docs/PATCHES.md](docs/PATCHES.md)** — Detailed specification of the 8 declarative host patches and multi-version `variants`.
- **[docs/COMPAT.md](docs/COMPAT.md)** — Supported DSH versions (`0.2.1-rc.1` – `0.2.2-rc.3`), host upgrade workflow, and runtime requirements.
- **[docs/DEBUG.md](docs/DEBUG.md)** — Troubleshooting decision tree, common error codes, and post-install smoke checks.
- **[docs/DESIGN.md](docs/DESIGN.md)** — Architectural rationale and engineering trade-offs.
- **[docs/PORTABILITY.md](docs/PORTABILITY.md)** — Cross-host capability matrix, model overlays, and `forge.profile/v1` schema.
- **[tools/abliterate/README.md](tools/abliterate/README.md)** — Optional offline weight-space activation direction projection script.
- **[tools/eval/README.md](tools/eval/README.md)** — Optional refusal-rate evaluation harness for local models.

---

## License

Released under the [MIT License](LICENSE). See [NOTICE.md](NOTICE.md) for attribution and scope notes.
