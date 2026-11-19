# Security Policy

## Supported Versions

| Version | Supported |
| :--- | :--- |
| `0.2.x` | Yes |
| `< 0.2.0` | No |

## Threat Model & Built-In Safeguards

PromptKeel is designed as an offline-first local developer CLI, transactional file writer, and loopback diagnostic studio:

- **Loopback-only HTTP surfaces:** Both the workbench (`127.0.0.1:7788` in `core/console.mjs`) and the DSH API route (`/promptkeel/api` in `lib/index.js`) validate `Host`, `Sec-Fetch-Site`, and `Origin` via shared parser `core/net.mjs`. Write operations on the workbench require per-process CSRF tokens under `script-src 'self'` CSP.
- **Symlink & path-traversal refusal:** Both `core/executor.mjs` (`lstatSync` preflight) and `lib/paths.mjs` resolve paths within declared `project` / `user` scopes and refuse writes through symbolic links.
- **Drift-protected rollback:** Every file modification records `beforeSha` / `afterSha` in `manifest.json` (`~/.promptkeel/plans/<id>/`). Revert refuses to overwrite externally modified files unless `--force` is specified.
- **Fail-closed gateway guard:** Free-pool proxy banners (`chatcmpl-freeipblk*`, `[magpie/*]`) cannot spoof model deliveries (`core/gateway.mjs`).
- **Release privacy gate:** `scripts/privacy_scan.sh` scans working trees and git history for local user paths, emails, secrets, UUIDs, and image metadata before publication.

## Reporting a Vulnerability

Do **not** open public issues for security vulnerabilities or suspected bypasses of local Host/CSRF/symlink guards.

Please report vulnerabilities privately through GitHub Security Advisories:

- **Private Advisory Form:** https://github.com/liangsiweiethan-wq/promptkeel/security/advisories/new

Include reproduction steps, affected files or versions, and any minimal fixture needed to verify the fix.
