# Personas

A persona is a prompt layer that sits beside the host prompt instead of replacing a host file. It lives in `prompt/personas/<id>.md` with a small frontmatter block:

```md
---
id: engineer
name: Engineer
mode: replace
harness: any
---
Work from evidence. Name the file and line you are reasoning about.
```

`mode` is the default when the persona is used; the CLI flag `--persona-mode` overrides it. `harness` records where the persona was written for (`any` keeps it portable).

| mode | composition | when it is the right choice |
| --- | --- | --- |
| `replace` | `[persona, ...hostParts-without-identity-claims]` | keep the host's working rules, drop its self-description |
| `strict` | `[persona]` | the host prompt contributes nothing useful |
| `append` | `[...hostParts, persona]` | add emphasis while keeping the host prompt intact |
| `off` | unchanged | ship the persona file without activating it |

`replace` removes a line only when it opens with a first-person identity claim (`You are`, `You're`, `I am`) and names a host. A line that mentions a host while stating behaviour stays, because deleting it would delete a working rule.

## Commands

```sh
dsh-forge personas                                  # list ids, default modes, sizes
dsh-forge compile codex --persona engineer --json   # default mode from frontmatter
dsh-forge compile codex --persona tutor --persona-mode strict
```

`compile` reports the active persona on `plan.persona` and lists `personas/<id>.md` at the head of `plan.prompt.sources`. Passing `off`, or omitting `--persona`, reproduces the plain composition byte for byte — the same `sha256` as a build with no persona layer.

## Relation to host patches

Patches (`lib/table.mjs`) change the host's own files and are verified against anchors. Personas never touch a host file: they change the prompt that `compile` hands to a target, so they work on every adapter, including the ones that only accept a system message. A persona with `mode: strict` and no host prompt is the smallest possible delivery for a host that exposes a single system-message field.
