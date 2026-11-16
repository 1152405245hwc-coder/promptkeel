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
| gemini | replace-full | `GEMINI_SYSTEM_MD` replaces the built-in system prompt | research |
| codex | replace-full | `model_instructions_file` replaces the built-in block | research |
| continue | replace-full | `chatOptions.baseAgentSystemMessage` | research |
| dsh | replace-with-residue | patched prompt tables + `~/.dsh/prompt-inject.md` | measured |
| claude-code | append-only | `--system-prompt` appends after a fixed identity block | research |
| cursor / windsurf / opencode / aider | append-only | rule files add to the built-in prompt | research |
| generic | unobservable | protocol-level system message | measured |

`source: research` means the mechanism was read from host documentation and issue threads. It is recorded so a later reader can tell which rows have been confirmed by running the host here.

`compile` reports the grade on `plan.delivery`, and `dsh-forge grades` prints the whole table. An `append-only` host with no shim channel also gets an `improvements` note: a shim is the only route that can bypass a fixed prefix when the host reads a prompt from the environment.
