# Cross-Host Portability

`dsh-forge` separates host-specific runtime patching from portable agent configuration. The host registry currently includes <!-- forge-facts:begin kind=profiles -->13<!-- forge-facts:end --> adapters; DSH is one high-permission adapter rather than the core platform assumption. Its patch surface, generated from `lib/table.mjs`:

<!-- forge-facts:begin -->
23 host patches · 18 patched files · 17 `@deepseek-ai/*` packages · layers: approval 7, sandbox 9, turn 1, persona 4, session 2 · host range `>=0.2.1-rc.1 <0.3.0`
<!-- forge-facts:end -->

1. **Native DSH profile (`dsh`)** — applies the <!-- forge-facts:begin kind=patches -->23<!-- forge-facts:end --> version-gated host patches (`lib/table.mjs`), handles `app.asar` unpacking, and installs `~/.dsh/prompt-inject.md`.
2. **Host-adapter profiles (`claude-code`, `codex`, `gemini`, `opencode`, `continue`, `cursor`, `windsurf`, `aider`, `hermes`, `openclaw`, `muse`, `generic`)** — compile the same modular prompt into each harness's documented configuration files or launch shims without patching minified runtime code.

```
Profile JSON ──▶ Host Adapter ──▶ Compiler (core/compile) ──▶ Executor (core/executor)
   (what)          (where)          (pure plan + bytes)        (transactional write)
                                             │
                                             └──▶ Verify / Revert
```

## 1. Host Matrix

| Host | Profile | Support | Prompt Surface | Policy Surface | Rollback | Notes |
|---|---|---|---|---|---|---|
| DSH macOS | `dsh` | `verified` | `~/.dsh/prompt-inject.md` + Cordis section | <!-- forge-facts:begin kind=patches -->23<!-- forge-facts:end --> host patches (`lib/table.mjs`) | manifest + `sha256` | `0.2.1-rc.1` – `0.2.2-rc.3` tested |
| DSH Linux/Windows | `dsh` + `--host-root` | `experimental` | same | same anchors, custom install root | manifest + `sha256` | pass `--host-root` |
| Claude Code | `claude-code` | `verified` | `CLAUDE.md` managed block + executable `.claude/dsh-forge-shim.sh` + `/dsh-forge` | `.claude/settings.json` (`permissions.defaultMode`) | byte-exact | `append-only` (CLI 57-char identity prefix) |
| Codex CLI | `codex` | `verified` | `.codex/forge-instructions.md` + `AGENTS.md` | `.codex/config.toml` (`model_instructions_file`, `approval_policy`, `sandbox_mode`) | byte-exact | `replace-full` (`B4`) |
| Gemini CLI | `gemini` | `experimental` | `.gemini/system.md` + `GEMINI.md` + `.gemini/dsh-forge-shim.sh` (`GEMINI_SYSTEM_MD`) | `.gemini/settings.json` (`autoAccept`) | byte-exact | `replace-full` (`B4`) via shim env |
| OpenCode | `opencode` | `experimental` | `AGENTS.md` managed block | `opencode.json` (`permission`) | byte-exact | `append-only`, project-scoped |
| Continue | `continue` | `experimental` | `.continue/config.yaml` (`chatOptions.baseAgentSystemMessage`) + `.continue/rules/dsh-forge.md` | `.continue/config.yaml` | byte-exact | `replace-full` (`B4`) |
| Generic API | `generic` | `experimental` | system message only | unsupported | n/a | caller consumes `plan.prompt.text` |
| Hermes | `hermes` | `experimental` | `~/.hermes/SOUL.md` + `.hermes.md` | `~/.hermes/config.yaml` | byte-exact | `replace-with-residue` |
| OpenClaw | `openclaw` | `experimental` | `~/.kimi_openclaw/workspace/AGENTS.md` + `AGENTS.md` | unsupported | byte-exact | `append-only` |
| Muse | `muse` | `experimental` | prompt-only | unsupported | n/a | `unobservable` |
| Cursor | `cursor` | `experimental` | `.cursorrules` legacy managed block | unsupported | byte-exact | active session unobservable |
| Windsurf | `windsurf` | `experimental` | `.windsurfrules` legacy managed block | unsupported | byte-exact | active session unobservable |
| Aider | `aider` | `experimental` | `CONVENTIONS.md` managed block | unsupported | byte-exact | file must be read by Aider |

`verified` means the full `compile → apply → verify-plan → revert-plan` cycle is covered by automated tests for the profile's target files. It does not by itself prove that a real host session loaded the configuration; adapters report runtime activation separately as `active`, `unobservable`, or `NOT_COVERED`.

Each profile may also declare `risk`, `mutatesHost`, `requiresRestart`, and `activationEvidence`. These are operational metadata used by status, diagnostics, and the control panel. They document impact and proof requirements without changing the profile's existing behavior.

## 2. Model Overlays

Model overlays (`models/*.json` + `prompt/models/*.md`) tune instruction style per model family without forking `prompt/core.md`. Composition order is fixed:

```
core.md ──▶ models/<model>.md ──▶ hosts/<host>.md ──▶ modes/<mode>.md (optional)
```

| Model ID | Overlay File | Default Profiles | Focus |
|---|---|---|---|
| `deepseek` | `prompt/models/deepseek.md` | `dsh`, `generic` | Concise Chinese output, tool-first verification, `path:line` references |
| `claude` | `prompt/models/claude.md` | `claude-code`, `generic` | Direct artifact delivery without policy preamble |
| `gpt` | `prompt/models/gpt.md` | `codex`, `cursor`, `windsurf`, `aider`, `continue`, `generic` | Decisive answer with falsifier and copy-pasteable commands |
| `gemini` | `prompt/models/gemini.md` | `gemini`, `generic` | Numbered multi-step execution and verification evidence |
| `qwen` | `prompt/models/qwen.md` | `opencode`, `generic` | Simplified Chinese default, direct tool execution |
| `glm` | `prompt/models/glm.md` | `generic`, `hermes`, `openclaw` | Simplified Chinese default, answer in the requested form |
| `local` | `prompt/models/local.md` | `generic` | Short single-task paragraphs for open-weight models |

## 3. Core Guarantees

| Guarantee | Mechanism |
|---|---|
| **Deterministic compilation** | Same `(profile, model, mode)` produces the exact same `planId` and prompt `sha256` across machines; absolute local paths are excluded from the `planId` digest (`core/compile.mjs`). |
| **Byte-exact rollback** | Every existing file is backed up under `~/.dsh-forge/plans/<id>/files/` with `beforeSha` and `afterSha` before the first write (`core/executor.mjs`). |
| **Explicit capability reporting** | Every profile declares `verified`, `experimental`, or `unsupported` across `prompt`, `approval`, `sandbox`, `tools`, and `rollback` (`core/capabilities.mjs`). |
| **Drift protection** | `revert-plan` re-hashes every target file and refuses to overwrite files edited after apply unless `--force` is passed. |
| **Scope containment** | Target paths are resolved strictly inside their declared `project` or `user` root; `..` traversal and symlinks (including dangling symlinks) are rejected before any write. |

## 4. Profile Schema (`forge.profile/v1`)

```json
{
  "schema": "forge.profile/v1",
  "id": "codex",
  "name": "Codex CLI",
  "version": "0.1.0",
  "host": "codex",
  "support": "verified",
  "risk": "medium",
  "mutatesHost": false,
  "requiresRestart": true,
  "activationEvidence": ["config", "session"],
  "prompt": { "core": "core.md" },
  "model": "gpt",
  "capabilities": {
    "prompt": "verified",
    "approval": "verified",
    "sandbox": "verified",
    "tools": "verified",
    "rollback": "verified"
  },
  "targets": [
    { "kind": "markdown-block", "path": "AGENTS.md", "scope": "project", "blockId": "system" }
  ]
}
```

Supported target kinds:
- `markdown-block`: idempotent `<!-- dsh-forge:begin <blockId> --> ... <!-- dsh-forge:end <blockId> -->` section that preserves surrounding user text.
- `json-merge`: recursive object merge preserving unrelated keys.
- `toml-merge`: top-level key update/insertion placed before any `[table]` header so root keys never leak into sub-tables.
- `yaml-merge`: idempotent YAML key/nested-object merge guarded by `# dsh-forge:begin config` / `# dsh-forge:end config` (preserves user keys and comments).
- `write-shim`: executable (`0755`) POSIX shell wrapper setting `DSH_FORGE_PROMPT` and launching the host binary with env overrides or CLI append flags.
- `command`: host session slash command Markdown file (e.g. `.claude/commands/dsh-forge.md`).
- `file`: whole-file prompt write (used for `~/.dsh/prompt-inject.md`, `.codex/forge-instructions.md`, and `.gemini/system.md`).
- `dsh-patches`: delegates to the native version-gated DSH patch engine (`lib/engine.mjs`).
- `prompt-only`: emits rendered prompt in the compiled plan without writing files.

## 5. CLI Workflow

```bash
# List available profiles, models, and detected local hosts
dsh-forge profiles
dsh-forge models
dsh-forge hosts

# Pure compile: inspect or save the plan without touching host files
dsh-forge compile claude-code --model claude --mode coding --out /tmp/plan.json

# Transactional apply (preview by default; writes only with --yes)
dsh-forge apply --profile codex --dry-run
dsh-forge apply --profile codex --yes

# Inspect, verify hashes, and roll back applied plans
dsh-forge plans
dsh-forge verify-plan <plan-id>
dsh-forge revert-plan <plan-id>
```

## 6. Boundaries

- The <!-- forge-facts:begin kind=patches -->23<!-- forge-facts:end --> version-gated anchors in `lib/table.mjs` and `lib/asar.mjs` are specific to DeepSeek Harness and are never applied to other hosts.
- Saved plan JSON files (`--out plan.json`) contain resolved absolute target paths for the local machine and should be treated as machine-local artifacts.
