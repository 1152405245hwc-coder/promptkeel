# Console & Local Workbench

`dsh-forge console` serves the local workbench at `http://127.0.0.1:7788`, sharing UI design tokens (`ui/tokens.mjs`) and doctor/compiler outputs directly with the CLI.

```bash
dsh-forge console [--port 7788] [--state <dir>]
dsh-forge console --once [--json]
```

## Routes

| Path | Purpose |
| --- | --- |
| `/` | Read-only overview card & doctor check summary (pure SSR HTML in `renderOverview()`) |
| `/workbench` | Interactive Prompt & Strategy Studio: compile profiles, run static probes, preview & apply/save snapshots |
| `/plans` | List applied plans with hash verification (`verify-plan`) and byte-exact rollback (`revert-plan`) |
| `/live` | Live Magpie `:3425` / API gateway runner with strategy presets, model discovery, and verdict classification |
| `/patches` | Layer-filtered DSH patch table with confirmation-gated dry-run, apply, upgrade, and revert actions |
| `/channels` | Delivery channel classification and effect timing per profile |
| `/grades` | Dynamic per-host delivery grades (`replace-full` -> `unobservable`) verified from compiled actions |
| `/personas` | Prompt personas (`replace`, `strict`, `append`, `off`) and transform metadata |
| `/audit` | Append-only event audit summary and snapshot inventory |
| `/api/state` | Full current JSON state payload (`GET`) |

## Security & Isolation Model

- **Loopback only**: binds strictly to `127.0.0.1` and rejects non-loopback `Host` headers, `Origin` mismatches, `Origin: null`, and `Sec-Fetch-Site: cross-site`.
- **Single-instance lock**: writes `<state>/console.pid`, refuses a live duplicate server, and replaces stale pid files cleanly (`defaultStateRoot` defaults to `$DSH_FORGE_STATE` -> `$XDG_STATE_HOME/dsh-forge` -> `~/.dsh-forge`).
- **CSP & CSRF**: serves interactive logic from external `/assets/workbench.js` under `script-src 'self'` (no inline `<script>`), and requires a per-process `x-forge-csrf` header on every mutating `POST /api/*` request plus explicit confirmation prompts for disk writes or rollbacks.
- **Method discipline**: `POST /` and non-API routes reject writes with `405 Allow: GET, HEAD`.
