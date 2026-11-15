# Cross-Host Portability

`dsh-forge` separates host-specific runtime patching from portable agent configuration:

1. **Native DSH profile (`dsh`)** — applies the 8 version-gated JS patches (`lib/table.mjs`), handles `app.asar` unpacking, and installs `~/.dsh/prompt-inject.md`.
2. **Host-adapter profiles (`claude-code`, `codex`, `gemini`, `opencode`, `generic`)** — compile the same modular prompt and permission policy into each harness's documented configuration files without patching minified runtime code.

```
Profile JSON ──▶ Host Adapter ──▶ Compiler (core/compile) ──▶ Executor (core/executor)
   (what)          (where)          (pure plan + bytes)        (transactional write)
                                             │
                                             └──▶ Verify / Revert
```

## 1. Host Matrix

| Host | Profile | Support | Prompt Surface | Policy Surface | Rollback | Notes |
|---|---|---|---|---|---|---|
| DSH macOS | `dsh` | `verified` | `~/.dsh/prompt-inject.md` + Cordis section | 8 JS patches (`lib/table.mjs`) | manifest + `sha256` | `0.2.1-rc.1` – `0.2.2-rc.3` tested |
| DSH Linux/Windows | `dsh` + `--host-root` | `experimental` | same | same anchors, custom install root | manifest + `sha256` | pass `--host-root` |
| Claude Code | `claude-code` | `verified` | `CLAUDE.md` managed block | `.claude/settings.json` (`permissions.defaultMode`) | byte-exact | project-scoped |
| Codex CLI | `codex` | `verified` | `AGENTS.md` managed block | `~/.codex/config.toml` (`approval_policy`, `sandbox_mode`) | byte-exact | root-table TOML merge |
| Gemini CLI | `gemini` | `experimental` | `GEMINI.md` managed block | `.gemini/settings.json` (`autoAccept`) | byte-exact | CLI setting keys may vary |
| OpenCode | `opencode` | `experimental` | `AGENTS.md` managed block | `opencode.json` (`permission`) | byte-exact | project-scoped |
| Generic API | `generic` | `experimental` | system message only | unsupported | n/a | caller consumes `plan.prompt.text` |

`verified` means the full `compile → apply → verify-plan → revert-plan` cycle is covered by automated tests for the profile's target files.

## 2. Model Overlays

Model overlays (`models/*.json` + `prompt/models/*.md`) tune instruction style per model family without forking `prompt/core.md`. Composition order is fixed:

```
core.md ──▶ models/<model>.md ──▶ hosts/<host>.md ──▶ modes/<mode>.md (optional)
```

| Model ID | Overlay File | Default Profiles | Focus |
|---|---|---|---|
| `deepseek` | `prompt/models/deepseek.md` | `dsh`, `generic` | Concise Chinese output, tool-first verification, `path:line` references |
| `claude` | `prompt/models/claude.md` | `claude-code`, `generic` | Direct artifact delivery without policy preamble |
| `gpt` | `prompt/models/gpt.md` | `codex`, `generic` | Decisive answer with falsifier and copy-pasteable commands |
| `gemini` | `prompt/models/gemini.md` | `gemini`, `generic` | Numbered multi-step execution and verification evidence |
| `qwen` | `prompt/models/qwen.md` | `opencode`, `generic` | Simplified Chinese default, direct tool execution |
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
    { "kind": "markdown-block", "path": "AGENTS.md", "scope": "project", "blockId": "system" },
    {
      "kind": "toml-merge",
      "path": ".codex/config.toml",
      "scope": "user",
      "value": { "approval_policy": "never", "sandbox_mode": "danger-full-access" }
    }
  ]
}
```

Supported target kinds:
- `markdown-block`: idempotent `<!-- dsh-forge:begin <blockId> --> ... <!-- dsh-forge:end <blockId> -->` section that preserves surrounding user text.
- `json-merge`: recursive object merge preserving unrelated keys.
- `toml-merge`: top-level key update/insertion placed before any `[table]` header so root keys never leak into sub-tables.
- `file`: whole-file prompt write (used for `~/.dsh/prompt-inject.md`).
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

- The 8 JS anchors in `lib/table.mjs` and `lib/asar.mjs` are specific to DeepSeek Harness and are never applied to other hosts.
- Saved plan JSON files (`--out plan.json`) contain resolved absolute target paths for the local machine and should be treated as machine-local artifacts.
