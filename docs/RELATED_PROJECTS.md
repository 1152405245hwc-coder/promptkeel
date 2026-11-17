# Related Projects & Isolation Boundaries

`dsh-forge` is maintained as an independent, modular repository and does **not** share state or mutate external live runtime installations.

## Open-Source & Community Landscape

The architecture draws lessons from the following community implementations and field research (see [docs/research/README.md](research/README.md)):

| Project / Reference | Primary Technique Adopted / Evaluated | Integration in `dsh-forge` |
| --- | --- | --- |
| `xqpsec/dsh-jailbreak` | Request-boundary rewriting inside DeepSeek client/loop | Evaluated for request boundary semantics; replaced with anchor-verified code/prompt patches in `lib/table.mjs`. |
| `xxy0722/dsh-purge-deep` | `session.deriveMessages()` cleaning & multi-turn pincer framing | Implemented via opt-in `cleanSessionMessages()` in `lib/inject.mjs` / `lib/index.js` and `core/strategy.mjs` multi-turn scripts. |
| `mortyandtimo/dsh-purge-plus` | Node runtime alignment, TUN/fake-ip safety, idempotent managed anchors | Adopted strict loopback `Host`/`Origin`/CSRF verification and deterministic begin/end markers for Markdown, TOML, and YAML. |
| `ZiChuanLan/agent-purge` | Cross-host persona & CLI configuration delivery | Generalized into schema-validated `profiles/`, `core/compile.mjs`, `core/executor.mjs`, and `hosts/table.mjs`. |
| `BOWLUNA/dsh-custom-mode` | DSH settings/Cordis plugin integration | Integrated cleanly into `lib/index.js` Cordis service injection and sidebar UI tabs (`client/src/entry.js`). |
| `elfmingh/dsh-prompt-manager` | Scoped prompt tiers & slash command re-injection | Delivered via `lib/preset.mjs` policies (`strict`, `fallback`, `always`) and `.claude/commands/dsh-forge.md` slash action. |

## Strict Runtime Isolation

To prevent accidental interference with an operator's active desktop setup:

- `dsh-forge` workspace plans, snapshots, batches, and console locks default to `$XDG_STATE_HOME/dsh-forge` or `~/.dsh-forge` (overridable via `--state` or `DSH_FORGE_STATE`), rather than mixing forge state into `~/.dsh/`.
- Native DSH patching only writes under `~/.dsh/dsh-forge` when explicitly operating on `--dsh-home` / `DSH_HOME` and host backups (`apply` / `revert` / `prompt install`).
- External installations (live DSH desktop profiles, local `dsh-purge*` bundles, and separate operations scripts) are outside `dsh-forge` scope and remain untouched by test suites and CLI plan commands.
