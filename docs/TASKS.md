# Project Tasks & Release Checklist

## Completed Architecture Milestones

- **Workspace & State Hygiene (`core/executor.mjs`, `lib/paths.mjs`, `bin/dsh-forge.js`)**:
  Unified `defaultStateRoot()` to `$DSH_FORGE_STATE` -> `--home/.dsh-forge` -> `$XDG_STATE_HOME/dsh-forge` -> `~/.dsh-forge`, eliminating silent leaks into `~/.dsh/`. Consolidated micro-modules into coherent `core/` owners (`contract.mjs`, `compile.mjs`, `executor.mjs`, `strategy.mjs`, `gateway.mjs`, `index.mjs`).
- **True Cross-Host `replace-full` (`B4`) Delivery (`profiles/`, `core/executor.mjs`, `core/grades.mjs`)**:
  Implemented `mergeYaml` (`yaml-merge`) and executable `write-shim` (`0755`) targets across `codex` (`.codex/config.toml` `model_instructions_file`), `gemini` (`.gemini/system.md` + `GEMINI_SYSTEM_MD` shim), `continue` (`.continue/config.yaml` `chatOptions.baseAgentSystemMessage`), and `claude-code` (`--append-system-prompt-file` shim + slash + permissions). Made `core/grades.mjs` verify actual compiled actions dynamically.
- **Strategy & Gateway Engine (`core/strategy.mjs`, `core/gateway.mjs`, `scripts/live_matrix.mjs`, `bin/dsh-forge.js run`)**:
  Promoted `variable` wrapping, `crescendo` / `deep` / `layered` multi-turn scripts (fixing multi-turn `response.reply` forwarding), `prefill`, and `stuffContext` dilution into first-class strategies supporting Magpie `:3425` and standard OpenAI/Anthropic/GLM APIs.
- **DSH `0.2.2-rc.3` Verified Anchors & Session Cleaning (`lib/table.mjs`, `lib/inject.mjs`, `lib/index.js`)**:
  Expanded verified patch table from 16 to 23 entries (18 files, 17 `@deepseek-ai/*` packages) across all 5 canonical layers (`approval`, `sandbox`, `turn`, `persona`, `session`) plus opt-in `cleanSessionHistory` message derivation hook.
- **Release-Grade Workbench UI (`ui/tokens.mjs`, `ui/workbench.js`, `core/console.mjs`, `client/src/entry.js`)**:
  Shared design tokens, CSRF-protected `/api/*` workbench (`Compile`, `Probe`, `Apply/Revert`, `Plans`, `Live Runner`, `Patches`, `Audit`), CSP `script-src 'self'`, and updated DSH sidebar bundle (`工作台` Studio tab).

## Verification & Release Gates

1. Offline suite: `npm test`, `npm run verify:profiles`, `npm run check:repo`, `npm run docs:check -- --check`.
2. Host dry-run check: `npm run verify` (`23/23` patches ready on target host).
3. Live bounded Magpie evaluation: compare `direct` vs `variable+contract` vs `deep` vs `prefill` vs `stuff` with `--repeat 3` on safe capability & adult policy-edge probes (strictly excluding `minor`, `bio`, `chem`, weapons).
4. Git identity & privacy gate: rewrite history emails/names to `dsh-forge <forge@local>`, pass `npm run release:check` with zero `.privacy-allow`.
