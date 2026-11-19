# dsh-forge-kit

[中文文档](README.zh-CN.md)

[![CI](https://img.shields.io/badge/CI-Node%2020+-000?style=flat-square)](#verification--quality-gate)
[![License: MIT](https://img.shields.io/badge/License-MIT-000?style=flat-square)](LICENSE)
[![Runtime Dependencies: 0](https://img.shields.io/badge/Runtime%20Deps-0-000?style=flat-square)](package.json)

> **New to this repo?** Start with [docs/ONBOARDING.md](docs/ONBOARDING.md) for a 30-minute walkthrough and [docs/ENGINEERING_RULES.md](docs/ENGINEERING_RULES.md) for repo invariants.

**Deterministic prompt/policy compiler, zero-drift transactional rollback, and persistent adaptive delivery sessions (`dsh-session`) across a verified 4-host core (`DSH`, `Claude Code`, `Codex CLI`, `OpenCode`) — zero runtime dependencies.**

CLI binaries: `dsh-forge-kit`, `dsh-forge`, `dsh-session`.

```text
┌──────────────┐   compile    ┌──────────────┐   apply/verify ┌──────────────────┐
│ profiles/ +  │ ───────────▶ │ pure planId  │ ─────────────▶ │ Verified 4 Hosts │
│ prompt/      │   <480 tok   │ + sha256     │   revert-plan  │ & byte-exact bak │
└──────────────┘              └──────────────┘                └──────────────────┘
┌──────────────┐   buildTurn  ┌──────────────┐   noteTurn     ┌──────────────────┐
│ dsh-session  │ ───────────▶ │ gateway/CLI  │ ─────────────▶ │ verdict + UCB1   │
│ family ladder│   shape/mode │ endpoint     │   degradation  │ family prior     │
└──────────────┘              └──────────────┘                └──────────────────┘
```

![dsh-forge-kit panel](docs/ui-preview.png)

---

## Core Pillars (`dsh-forge-kit`)

| Dimension | Legacy Community Patch Bundles | `dsh-forge-kit` Architecture |
| :--- | :--- | :--- |
| **Deterministic Policy Compiler** | Monolithic prompt files or ad-hoc edits without hashes | Modular `core + persona + model + host + mode` compiler (~268–361 tokens across <!-- forge-facts:begin kind=profiles -->13<!-- forge-facts:end --> profiles), strict `< <!-- forge-facts:begin kind=promptCeiling -->480<!-- forge-facts:end -->` token budget gate, and machine-independent `planId` |
| **Zero-Drift Rollback** | Single `.bak` file overwritten on re-run | Timestamped `manifest.json` + `beforeSha`/`afterSha` drift checks + `lstatSync` symlink refusal under `~/.dsh-forge-kit/plans/` (`apply` / `verify-plan` / `revert-plan`) |
| **Persistent Delivery Sessions** | One-shot prompt generation with silent drift | `dsh-session` / `dsh-forge session` persists turns, stamps `classifierHash`, degrades `systemMode` (`full → inline → lock → bare`) and `shape` (`history → single → bare`), and learns per-family UCB1 arm ladders |
| **Verified 4-Host Core** | Locked to one host or shallow unverified targets | Golden-fixture verified lifecycle across **DSH**, **Claude Code**, **Codex CLI**, and **OpenCode** (plus 9 frozen/experimental profiles) |
| **Verification & Workbench** | Visual status badge only | 3-stage DSH proof check (`proof1-patches`, `proof2-prompt`, `proof3-session`), HTTP fixture E2E suite, `127.0.0.1:7788` workbench, and ~25 KB zero-dep DSH sidebar |
| **Technical Specification (DSH Native)** | 80+ brittle UI string replacements | <!-- forge-facts:begin kind=patches -->23<!-- forge-facts:end --> version-gated DSH runtime patches across <!-- forge-facts:begin kind=files -->18<!-- forge-facts:end --> `@deepseek-ai/*` files with `variants` support |

DSH technical surface summary (generated from `lib/table.mjs`):

<!-- forge-facts:begin -->
23 host patches · 18 patched files · 17 `@deepseek-ai/*` packages · layers: approval 7, sandbox 9, turn 1, persona 4, session 2 · host range `>=0.2.1-rc.1 <0.3.0`
<!-- forge-facts:end -->

---

## Project Architecture & Directory Structure

`dsh-forge-kit` is organized into a host-neutral core (`core/`) and a DSH-native runtime adapter (`lib/`, `client/`):

1. **Cross-Host Compiler, Executor & Session Runtime (`core/`, `hosts/`, `profiles/`, `models/`)**: Compiles deterministic `planId` plans, manages persistent delivery sessions (`core/session.mjs`, `core/families.mjs`), drives multi-provider gateways (`core/gateway.mjs`), and enforces byte-exact rollback (`core/executor.mjs`).
2. **DeepSeek Harness Native Adapter (`lib/`, `client/`)**: Inspects/unpacks `app.asar` when needed, applies the <!-- forge-facts:begin kind=patches -->23<!-- forge-facts:end --> version-gated patches (`lib/table.mjs`), registers `forge:prompt` via Cordis, and serves `/dsh-forge-kit/api`. See [lib/README.md](lib/README.md).

```text
dsh-forge-kit (repo dir: dsh-forge/)
├── bin/
│   ├── dsh-forge.js        # Thin CLI dispatcher (+ `session` subcommand)
│   ├── dsh-session.js      # Persistent adaptive session CLI
│   └── commands/           # Domain-split handlers (shared, dsh, plan, runtime)
├── core/                   # Host-neutral public API (curated exports in core/index.mjs)
│   ├── contract.mjs        # Schema validation & loaders for profiles/*.json and models/*.json
│   ├── capabilities.mjs    # Capability matrix & preflight
│   ├── prompt.mjs          # Deterministic multi-layer prompt renderer & CJK-aware token estimator
│   ├── compile.mjs         # Pure compiler + normalizeContext: (profile, model, mode) -> plan
│   ├── executor.mjs        # Transactional writer (block, json, toml, yaml, shim, verify, rollback)
│   ├── strategy.mjs        # First-class strategy presets (variable, crescendo, deep, layered, prefill, stuff)
│   ├── families.mjs        # Model-family routing & per-family arm ladders
│   ├── session.mjs         # Persistent delivery sessions, frame lock, verdict/recovery, UCB1 learning
│   ├── gateway.mjs         # Multi-provider gateway client, classifierHash & proxy block guards
│   ├── net.mjs             # Shared Host/authority parser & loopback allow-list
│   ├── console.mjs         # Localhost workbench server (:7788) with CSRF + CSP guards
│   ├── batch.mjs           # Multi-platform batch compile/apply and compensation rollback
│   └── errors.mjs          # Structured ForgeError with stable machine-readable error codes
├── ui/                     # Shared console/workbench UI tokens & external JS assets
├── hosts/                  # Per-host environment detectors & golden-fixture session inspectors
├── profiles/               # <!-- forge-facts:begin kind=profiles -->13<!-- forge-facts:end --> declarative profiles (4 verified primary + 9 frozen/experimental)
├── models/                 # <!-- forge-facts:begin kind=models -->7<!-- forge-facts:end --> model family metadata & overlay bindings
├── prompt/                 # Modular prompt sources (core.md, adapters/, hosts/, models/, personas/, modes/)
├── lib/                    # DSH-native runtime, ASAR unpacker, 23 host patches & Cordis plugin
├── client/                 # DSH sidebar management UI (React.createElement source + built bundle)
├── scripts/                # Quality gates, docs sync, live_matrix, session runner, version bump
├── test/                   # Node.js built-in suite (unit, HTTP fixture E2E, golden host fixtures)
└── docs/                   # Onboarding, architecture, engineering rules, measurement rules, portability
```

---

## Verified Primary Hosts & Frozen Experimental Profiles

### Verified Primary Core (Golden-Fixture Covered)

| Host | Profile | Target Files / Channels | Delivery Grade |
| :--- | :--- | :--- | :--- |
| **DSH (macOS / Linux / Windows)** | `dsh` | `~/.dsh/prompt-inject.md` + Cordis `forge:prompt` + <!-- forge-facts:begin kind=patches -->23<!-- forge-facts:end --> runtime patches (`@deepseek-ai/*`) | `replace-with-residue` (runtime) |
| **Claude Code** | `claude-code` | `.claude/forge-prompt.md` + `CLAUDE.md` + `.claude/settings.json` + `.claude/commands/dsh-forge.md` + `.claude/dsh-forge-shim.sh` | `append-only` |
| **Codex CLI** | `codex` | `.codex/forge-instructions.md` + `.codex/config.toml` (`model_instructions_file`) + `.codex/dsh-forge-shim.sh` + `AGENTS.md` | `replace-full` |
| **OpenCode** | `opencode` | `AGENTS.md` (managed block) + `opencode.json` (`agent.build.prompt`, `permission`) | `replace-full` |

### Frozen / Experimental Profiles

| Host | Profile | Target Files Written | Status |
| :--- | :--- | :--- | :--- |
| **Gemini CLI** | `gemini` | `.gemini/system.md` + `.gemini/dsh-forge-shim.sh` (`GEMINI_SYSTEM_MD`) + `GEMINI.md` + `.gemini/settings.json` | `experimental` (frozen) |
| **Continue** | `continue` | `.continue/config.yaml` (`chatOptions.baseAgentSystemMessage`) + `.continue/rules/dsh-forge.md` | `experimental` (frozen) |
| **Hermes** | `hermes` | `~/.hermes/config.yaml` (`agent.system_prompt`) + `~/.hermes/SOUL.md` + `.hermes.md` (`blockId: "forge"`) | `experimental` (frozen) |
| **OpenClaw / AutoClaw** | `openclaw` | `~/.kimi_openclaw/workspace/AGENTS.md` + `AGENTS.md` | `experimental` (frozen) |
| **Cursor** | `cursor` | `.cursorrules` (legacy managed block) | `experimental` (frozen) |
| **Windsurf** | `windsurf` | `.windsurfrules` (legacy managed block) | `experimental` (frozen) |
| **Aider** | `aider` | `CONVENTIONS.md` (managed block) | `experimental` (frozen) |
| **Generic API / Local Weights** | `generic` | System prompt payload only (`prompt-only`) | `experimental` |
| **Muse** | `muse` | System prompt payload only — shipped prompt lives behind app seal | `unsupported` |

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

---

## Persistent All-Model Delivery Sessions (`dsh-session`)

`dsh-session` (also exposed as `dsh-forge session`) turns one-shot generation into a resumable, measured delivery loop. Session state lands under `~/.dsh-forge-kit/sessions/` (overridden by `--state` or `DSH_FORGE_KIT_STATE`):

- Re-asserts a short frame lock every turn and filters non-delivered turns out of replay while retaining all raw turns on disk for audit.
- Automatically degrades `systemMode` (`full → inline → lock → bare`) and `shape` (`history → single → bare`) on endpoint rejections or stalls, remembering the transport combination that succeeded.
- Stamps `classifierHash` per turn and blocks `chatcmpl-freeipblk*` / `[magpie/*]` proxy banners from masquerading as deliveries.
- Escalates withheld/thin/empty/blocked verdicts along per-family ladders (`deepseek` / `claude` / `gpt` / `gemini` / `glm` / `qwen` / `llama` / `generic`) with UCB1 cross-session learning. See [docs/SESSION.md](docs/SESSION.md).

---

## DeepSeek Harness (DSH) Installation & Workflow

```bash
# 1) Add dsh-forge-kit to a DSH profile (desktop shown)
cd ~/.dsh/profiles/desktop
pnpm add /path/to/dsh-forge-kit

# 2) Register dsh-forge-kit in dsh.profile.bundles (auto-ordered after dsh-purge* with backup)
npx dsh-forge profile enable --profile desktop

# 3) Run the 12-check diagnostic, preflight, and apply DSH host patches
npx dsh-forge doctor
npx dsh-forge apply --dry-run
npx dsh-forge apply --yes

# 4) Quit DSH completely (Cmd+Q), reopen, and verify all 3 runtime proofs
npx dsh-forge verify
```

### Coexistence with `dsh-purge`

When `dsh-purge-community` is installed in the same DSH profile, `dsh-forge-kit` must appear *after* `dsh-purge-community` in `dsh.profile.bundles` (`dsh-forge profile enable` migrates legacy `dsh-forge` entries and enforces ordering automatically). `cordis.patch.yml` disables legacy `dsh-purge*` and `dsh-forge` plugin nodes so only one `systemPrompt` section (`forge:prompt`) remains active.

The local HTTP control API mounts on DSH's loopback server under `/dsh-forge-kit/api` and enforces strict `Host`, `Sec-Fetch-Site`, and `Origin` checks plus a 256 KB request body limit.

---

## Upgrading and Updating

After pulling a new revision or installing an updated tarball, `upgrade` reverts the active backup for the current host version and re-applies the current patch table:

```bash
cd ~/.dsh/profiles/desktop
pnpm add /path/to/dsh-forge-kit
npx dsh-forge upgrade --dry-run
npx dsh-forge upgrade --yes
```

After a DSH application update, run `dsh-forge adapt` to verify anchors, `dsh-forge upgrade --yes` if all report `ready`, or `dsh-forge explain <patch-id>` if an anchor shifted.

---

## Delivery Grades, Channels, Personas, Transforms & Workbench

- **Delivery grades (`core/grades.mjs`)**: Dynamic grading (`replace-full`, `replace-with-residue`, `append-only`, `shim-only`, `unobservable`) derived from actual compiled actions (`dsh-forge grades`). See [docs/GRADES.md](docs/GRADES.md).
- **Delivery channels (`core/channels.mjs`)**: `project`, `install`, `shim`, `slash`, `none` (`dsh-forge channels --all`, `dsh-forge shim`). See [docs/CHANNELS.md](docs/CHANNELS.md).
- **Personas (`prompt/personas/*.md`)**: `replace`, `strict`, `append`, `off` across <!-- forge-facts:begin kind=personas -->13<!-- forge-facts:end -->+ bundled personas (`dsh-forge personas`). See [docs/PERSONAS.md](docs/PERSONAS.md).
- **Payload transforms (`core/transform.mjs`)**: `base64`, `rot13`, `leet`, `vowels`, `morse`, `ascii`, `reverse`, `split` (`dsh-forge transforms`). See [docs/TRANSFORMS.md](docs/TRANSFORMS.md).
- **Static probe harness (`core/probe.mjs`)**: 18 worst-case fixtures across 10 families with mandatory poisoned-prompt `selfCheck()` (`dsh-forge probe`). See [docs/PROBES.md](docs/PROBES.md).
- **Audit & snapshots**: `$DSH_HOME/dsh-forge-kit/logs/` (`dsh-forge audit`) and `<state>/snapshots/` (`dsh-forge snapshot`). See [docs/AUDIT.md](docs/AUDIT.md).
- **Workbench Console (`dsh-forge console`)**: Loopback `http://127.0.0.1:7788` studio protected by Host/Origin checks, `script-src 'self'` CSP, and per-process CSRF tokens. See [docs/CONSOLE.md](docs/CONSOLE.md).

---

## Verification & Quality Gate

```bash
npm ci --ignore-scripts
npm test                    # Unit, HTTP fixture E2E, golden host fixtures, security, ASAR, CLI tests
npm run verify:profiles     # Smoke-compile all 13 profiles under the 480-token ceiling
npm run check:repo          # Layering boundary, CLI surface, syntax, lockfile, privacy, tarball contents
npm run docs:check          # Ensure docs agree with lib/table.mjs & profiles/
npm run verify              # Tests + client bundle + Python AST + anchor drift + privacy scan
npm run release:check       # Full git history identity scan + packed tarball inspection
```

---

## Documentation

- **[docs/ONBOARDING.md](docs/ONBOARDING.md)** — 30-minute engineer ramp-up path, `core/` vs `lib/` boundary, and state layout.
- **[docs/ENGINEERING_RULES.md](docs/ENGINEERING_RULES.md)** — Anti-regression rules codified from git history and `0.2.0` audit findings.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Module layering, sequence diagrams, patch state machine, and cross-host compiler pipeline.
- **[docs/PORTABILITY.md](docs/PORTABILITY.md)** — Verified 4-host core, frozen experimental adapters, model overlays, and `forge.profile/v1` schema.
- **[docs/SESSION.md](docs/SESSION.md)** — Persistent delivery sessions: on-disk state, frame lock, transport degradation, family ladders, and stability metrics.
- **[docs/MEASUREMENT_RULES.md](docs/MEASUREMENT_RULES.md)** — The eight rules every published run has to satisfy, each traceable to the commit that forced it.
- **[docs/PATCHES.md](docs/PATCHES.md)** — Specification of the <!-- forge-facts:begin kind=patches -->23<!-- forge-facts:end --> declarative DSH patches and multi-version `variants`.
- **[docs/COMPAT.md](docs/COMPAT.md)** — Supported DSH versions (`0.2.1-rc.1` – `0.2.2-rc.3`), host upgrade workflow, and runtime requirements.
- **[docs/GRADES.md](docs/GRADES.md)** / **[docs/CHANNELS.md](docs/CHANNELS.md)** / **[docs/PERSONAS.md](docs/PERSONAS.md)** / **[docs/TRANSFORMS.md](docs/TRANSFORMS.md)** / **[docs/PROBES.md](docs/PROBES.md)**
- **[docs/LIVE_MATRIX.md](docs/LIVE_MATRIX.md)** / **[docs/PLAYBOOK.md](docs/PLAYBOOK.md)** / **[docs/EXTREME_TEST_REPORT.md](docs/EXTREME_TEST_REPORT.md)**
- **[docs/AUDIT.md](docs/AUDIT.md)** / **[docs/CONSOLE.md](docs/CONSOLE.md)** / **[docs/DEBUG.md](docs/DEBUG.md)** / **[docs/DESIGN.md](docs/DESIGN.md)**
- **[docs/RELEASE.md](docs/RELEASE.md)** / **[docs/TASKS.md](docs/TASKS.md)** / **[docs/RELATED_PROJECTS.md](docs/RELATED_PROJECTS.md)**

---

## License

Released under the [MIT License](LICENSE). See [NOTICE.md](NOTICE.md) for attribution and scope notes.
