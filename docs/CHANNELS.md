# Delivery channels

A profile decides *what* gets delivered; a channel is *how* it reaches the host. Every compiled action belongs to exactly one channel, and `compile` reports the result on `plan.channels`.

| channel | shape of the action | first visible | coverage today |
| --- | --- | --- | --- |
| `project` | file, managed block, TOML, or YAML config inside the repository (`AGENTS.md`, `.codex/config.toml`, `.continue/config.yaml`, etc.) | next turn | 20 actions across 10 profiles |
| `install` | host runtime state (`dsh.patches`, `~/.dsh/prompt-inject.md`, user-scope `.hermes/config.yaml`) | host restart / next session | 3 actions across 2 profiles (`dsh`, `hermes`) |
| `shim` | executable `0755` wrapper script (`write-shim`) exporting `DSH_FORGE_PROMPT` / `GEMINI_SYSTEM_MD`, Codex `-c model_instructions_file`, or CLI append flags | shell restart | 3 automatic (`claude-code`, `codex`, `gemini`), plus `promptkeel shim` |
| `slash` | a command file the host registers inside a session (`.claude/commands/*.md`) | session start | 1 action, `claude-code` |
| `none` | prompt composed but never written (`prompt-only`) | n/a | 2 profiles (`generic`, `muse`) |

`promptkeel channels` prints the rows for one profile; `promptkeel channels --all` prints the matrix for every profile in `profiles/`. The matrix is measured from the compiled plans, so it cannot drift from what `apply` would actually do.

## Shim

`promptkeel shim` renders a POSIX wrapper for a host that reads its system prompt from an environment variable:

```sh
promptkeel shim --binary /usr/local/bin/host \
  --prompt "$PWD/.promptkeel-state/prompt.md" \
  --env HOST_SYSTEM_PROMPT="$PWD/.promptkeel-state/prompt.md" \
  --note "host cli" \
  --out bin/host-forged
```

The script checks that the prompt file exists, exports `DSH_FORGE_PROMPT`, exports every `--env` pair, then `exec`s the real binary with all arguments unchanged. Output is deterministic, so a recompile diffs cleanly. Values are single-quote escaped; names must match `^[A-Z_][A-Z0-9_]*$`.

This channel exists because some hosts expose no configuration file for system prompts at all. Wrapping the binary is the only way in, and wrapping it also makes the prompt path explicit in the process the host actually runs.

## Why `none` is reported

A profile with only a `prompt-only` target produces a prompt and writes nothing. Calling that a `project` delivery would overstate the evidence, so it reports `none` and `activation` stays `unobservable`. The `generic` profile is the current example.
