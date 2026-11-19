# `lib/` — DSH-Native Runtime (Not a Shared Library)

`lib/` is **not** a general-purpose utility library. It contains code specific to the **DeepSeek Harness (DSH)** desktop/web installation:

- `table.mjs` & `engine.mjs` — version-gated DSH host patches and atomic backup/revert.
- `asar.mjs` — read-only `app.asar` inspection and atomic unpacker.
- `inject.mjs` & `preset.mjs` — `~/.dsh/prompt-inject.md` and `dsh.profile.bundles` integration.
- `doctor.mjs` & `console-state.mjs` — 12-point DSH host diagnostic checks.
- `index.js` — Cordis plugin (`promptkeel`), `/forge` slash command, and `/promptkeel/api` handler.
- `dsh-provider.mjs` & `dsh-contract.mjs` — synchronous bridge exposed to `core/`.

All host-neutral public APIs (prompt compiler, transactional executor, strategy engine, gateway client, and persistent `promptkeel-session` runtime) live in [`../core/`](../core/index.mjs). `core/` is strictly forbidden from importing `lib/` (enforced by `scripts/check_repo.sh`).
