# Delivery grades

A grade answers one question: how much of the host's own system prompt can a profile displace? It is a property of the host, not of the prompt quality, so the table lives in `core/grades.mjs` and every row names the mechanism that decides it.

| grade | meaning |
| --- | --- |
| `replace-full` | the host accepts a complete replacement of its built-in instruction text |
| `replace-with-residue` | patched built-in text plus an injected layer; traces of the original wording can survive |
| `append-only` | the host always keeps a built-in block above whatever is injected |
| `shim-only` | the only route is wrapping the binary |
| `unobservable` | nothing in the host can be read back, so no grade can be earned |

Current table:

| host | grade | mechanism | source |
| --- | --- | --- | --- |
| gemini | replace-full | `GEMINI_SYSTEM_MD` shim + `.gemini/system.md` replaces the built-in system prompt | verified-config |
| codex | replace-full | `model_instructions_file` in `.codex/config.toml` + `.codex/dsh-forge-shim.sh` + `.codex/forge-instructions.md` replaces built-in block | verified-config |
| continue | replace-full | `chatOptions.baseAgentSystemMessage` in `.continue/config.yaml` replaces base agent prompt | verified-config |
| opencode | replace-full | `agent.build.prompt` in `opencode.json` overrides the built-in `build` agent prompt (`AGENTS.md` appends project context) | measured |
| dsh | replace-with-residue | patched prompt tables + `~/.dsh/prompt-inject.md` | measured |
| claude-code | append-only | `--append-system-prompt-file` on `.claude/forge-prompt.md` appends after a fixed identity block | research |
| cursor / windsurf / aider | append-only | rule files add to the built-in prompt | research |
| generic | unobservable | protocol-level system message | measured |
| hermes | replace-with-residue | `SOUL.md` + `.hermes/config.yaml` (`agent.system_prompt`) + `.hermes.md` (`blockId: "forge"` clears `threat_patterns`) | measured |
| openclaw | append-only | `workspace/AGENTS.md` and `openclaw.json` add to a fixed main-process identity | measured |
| muse | unobservable | prompt assembled server-side; the local asset is inside the code signature | measured |

`source: research` means the mechanism was read from host documentation and issue threads. It is recorded so a later reader can tell which rows have been confirmed by running the host here.

`compile` reports the achieved grade dynamically on `plan.delivery` by inspecting `actions[]`, downgrading `codex`, `gemini`, `continue`, or `opencode` to `append-only` if their full-replacement target (`model_instructions_file`, `GEMINI_SYSTEM_MD` shim, `chatOptions.baseAgentSystemMessage`, or `agent.build.prompt`) is missing. An `append-only` host with no shim channel also receives an `improvements` note.
