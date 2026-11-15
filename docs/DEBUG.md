# Debugging and Troubleshooting

## Diagnostic Checklist

```
dsh-forge doctor FAIL / WARN
├─ host-root fail
│  └─ Set DSH_FORGE_HOST_ROOT=/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh
├─ host-version warn
│  └─ Run `dsh-forge adapt`; update HOST_VERSION_RANGE or patch variants in lib/table.mjs
├─ patches fail (miss / partial / ambiguous)
│  ├─ Run `dsh-forge explain <id>` to inspect anchor matches
│  └─ Update the anchor or add a version variant in lib/table.mjs
├─ plugin-conflicts fail
│  └─ Run `dsh-forge profile enable` so dsh-forge is listed after dsh-purge-community
├─ profile-bundle warn
│  └─ Run `dsh-forge profile enable --profile desktop`
└─ session-runtime warn
   └─ Start one conversation in DSH after enabling the plugin, then re-run `dsh-forge verify`
```

## Logs and Diagnostics

- Verbose stderr output: `DSH_FORGE_DEBUG=1 dsh-forge doctor`
- Read recent log entries: `dsh-forge log --limit 50`
- Clear log files: `dsh-forge log --clear`
- Export redacted diagnostic bundle: `dsh-forge collect`

## Post-Install Smoke Checks

After enabling the plugin, applying patches, and restarting DSH (`Cmd+Q`), you can verify runtime behavior in a new session:

1. **Direct execution**: Ask for a one-line summary of a local file; confirm the agent reads the file directly without unnecessary preamble.
2. **Instruction precedence**: In a workspace with custom `AGENTS.md` instructions, verify direct user instructions in the current turn take precedence.
3. **Sandbox access**: Run a command that writes outside the workspace or inspects host configuration; confirm no approval modal blocks execution.

## Common Errors

| Symptom | Cause | Fix |
|---|---|---|
| `preflight-failed` on `apply` | One or more patch anchors did not match | Run `dsh-forge adapt` and `dsh-forge explain <id>` |
| `host-version-mismatch` on `revert` | DSH was upgraded after the backup was created | Do not revert old backups onto a new host; run `dsh-forge upgrade --yes` instead |
| Blank Forge sidebar panel | `client/client.js` missing or outdated | Run `npm run build:client` and restart DSH |
| Session log check stays `WARN` | DSH has not started a new session since enabling `dsh-forge` | Quit DSH (`Cmd+Q`), reopen, send one message, and run `dsh-forge verify` |
| `target-escape` on `compile` | A profile target uses `..` or an absolute path outside its scope | Keep the target relative to its declared `user`/`project` root |
| `block-malformed` on `apply` | Managed block markers were edited or duplicated | Restore the file backup, then re-apply |
| `target-modified` on `revert-plan` | A target changed after apply | Inspect the diff; use `--force` only after taking your own backup |
| `budget exceeded` on `compile` | Core + model + host + mode overlays exceed 3200 tokens | Drop `--mode`, shorten the overlay, or raise `--budget` intentionally |

## Exit Codes

- `0`: Check or operation succeeded
- `1`: Check or operation failed
- `2`: Invalid CLI arguments
