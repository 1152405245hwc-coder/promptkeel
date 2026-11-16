# Audit and snapshots

Two separate records answer two different questions. The operation log says what the tool did to a host; snapshots keep the prompt it produced, so a later change can be compared against what actually ran.

## Operation log

`lib/log.mjs` appends one JSON object per event to `$DSH_HOME/dsh-forge/logs/forge-YYYYMMDD.jsonl`. Events come from the code paths that touch a host: `apply.blocked`, `apply.unpacked`, `apply.done`, `revert.done`, `upgrade.done`, `snapshot.written`, `console.start`.

`dsh-forge audit [--limit 100] [--json]` reads every day file, not just today's, and prints a count per event plus the last ten entries:

```
audit 3 events · 2 day(s)
   2  apply.done
   1  apply.blocked
```

A line that cannot be parsed is counted and reported (`1 unreadable line(s) skipped`) rather than dropped silently, which is how a truncated write shows up. `--limit` applies to parsed events, so unreadable lines never eat the quota. The write side stays in `lib/log.mjs`; `core/audit.mjs` only reads, so there is one writer and no second log to drift.

## Snapshots

`dsh-forge snapshot [profile] [--keep 5] [--days 7] [--max-bytes N]` composes the profile's prompt with the same compiler `compile` uses and writes it to `<state>/snapshots/snap-<UTC stamp>-prompt-<profile>.txt`. `--list` shows what is stored; `--json` returns the written file and the pruning result.

Retention runs after every write, in this order:

1. anything older than `--days` (default 7) is removed;
2. the oldest entries above `--keep` (default 5) are removed;
3. while the total exceeds `--max-bytes` (default 200 MiB), the oldest is removed.

The newest snapshot survives even when it alone exceeds the byte budget, because deleting the file that was just written would make the command useless. The timestamp lives in the filename, so ordering and age do not depend on mtime, which rsync, `cp -p`, and archive extraction all rewrite.

`/audit` on the [console](CONSOLE.md) shows the same event counts and snapshot rows, so a browser view and `dsh-forge audit` cannot disagree.
