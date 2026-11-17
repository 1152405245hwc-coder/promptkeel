# Compatibility

| DSH Version | dsh-forge | Status |
|---|---|---|
| `0.2.1-rc.1` – `0.2.2-rc.3` | `0.1.x` | Verified on `0.2.2-rc.2` and `0.2.2-rc.3` (all <!-- forge-facts:begin kind=patches -->16<!-- forge-facts:end --> anchors match across <!-- forge-facts:begin kind=files -->11<!-- forge-facts:end --> files; `apply` and `revert` restore identical `sha256` hashes, including packed `app.asar` builds) |
| `< 0.2.1` | — | Unsupported (`systemPrompt.section` and client slot packages unavailable) |
| `>= 0.3.0` | — | Blocked by default version range until anchors are verified with `dsh-forge adapt` |

## Patch Surface

<!-- forge-facts:begin kind=table -->
| Fact | Value |
| :--- | :--- |
| Host patches | 16 |
| Patched files | 11 |
| `@deepseek-ai/*` packages | 10 |
| Layers | `approval` 5 · `sandbox` 6 · `turn` 1 · `persona` 3 · `session` 1 |
| Host version range | `>=0.2.1-rc.1 <0.3.0` |
<!-- forge-facts:end -->

Generate with `node scripts/check_docs.mjs`; `--check` fails when a document disagrees with `lib/table.mjs`.

## Handling DSH Upgrades

The <!-- forge-facts:begin kind=patches -->16<!-- forge-facts:end --> patches modify <!-- forge-facts:begin kind=files -->11<!-- forge-facts:end --> files across <!-- forge-facts:begin kind=packages -->10<!-- forge-facts:end --> packages under `node_modules/@deepseek-ai/`. When DSH updates:

1. Run `dsh-forge adapt` to inspect all <!-- forge-facts:begin kind=patches -->16<!-- forge-facts:end --> patch anchors without modifying disk files.
2. If all <!-- forge-facts:begin kind=patches -->16<!-- forge-facts:end --> report `ready`, run `dsh-forge upgrade --yes`.
3. If any patch reports `miss` or `partial`, run `dsh-forge explain <patch-id>` to inspect the target file and add a versioned entry to `variants` in `lib/table.mjs`.
4. `dsh-forge revert` checks `manifest.hostVersion` against the current DSH version and refuses to write older backups over a newer host unless `--force` is specified.

## Runtime Requirements

- **Node.js `>= 22`** (uses built-in `node:test`, `util.parseArgs`, and `import.meta.dirname`; zero external npm runtime dependencies).
- **`zstd`** in `PATH` (or `DSH_FORGE_ZSTD`) for decompressing `session.v4.jsonl.zstd` during `dsh-forge verify`.
- **Operating Systems**:
  - macOS layout (`/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh` or sealed `app.asar`) is verified.
  - Linux and Windows candidate paths are built into `lib/paths.mjs` and can be overridden with `--host-root` or `DSH_FORGE_HOST_ROOT`.
  - Cross-host profiles (`claude-code`, `codex`, `gemini`, `opencode`, `cursor`, `windsurf`, `aider`, `continue`, `generic`) are platform-independent across macOS, Linux, and Windows at the configuration-plan layer. Runtime activation for experimental adapters remains `NOT_COVERED`. See [PORTABILITY.md](PORTABILITY.md).
