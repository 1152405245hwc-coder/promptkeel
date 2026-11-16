# Console

`dsh-forge console` renders the same facts the CLI reports, on a loopback-only page. It is read-only: every request is a `GET` (or `HEAD`), the process never touches the host, and there is no script on the page.

```
dsh-forge console [--port 7788] [--state <dir>]
dsh-forge console --once [--json]
```

`--once` prints the overview and exits, which is what you want inside a script or a CI log. Without it the process serves until `SIGINT`/`SIGTERM`.

## Pages

| path | shows |
| --- | --- |
| `/` | host version, ready patch count, every doctor check, activation state and whether a restart is pending |
| `/patches` | each patch with its layer, status and match count |
| `/channels` | per-profile channel counts (`project`, `install`, `slash`, `none`) |
| `/grades` | per-profile delivery grade, evidence source and mechanism |
| `/personas` | persona id, default mode, harness scope and size |
| `/api/state` | the whole state object as JSON, for anything that wants to parse it |

## One instance per state directory

The console writes `<state>/console.pid` and refuses to start when that pid is still alive:

```json
{ "ok": false, "code": "console-lock", "error": "console already running with pid 6405" }
```

A pid left behind by a crashed process is replaced, so a stale file never needs manual cleanup. `SIGINT` and `SIGTERM` remove the file on the way out.

The default state directory is `$HOME/.dsh/dsh-forge`; `--state` points it elsewhere, which is how the tests and CI avoid touching a real home directory.

## Why the page can be trusted

The console does not recompute anything. `consoleState()` calls `doctor()` and renders its result, so a page and `dsh-forge doctor` cannot disagree about the same host. Profiles are compiled with the current working directory as `projectRoot`, and a profile that fails to compile is shown with its error instead of disappearing from the table.

Requests never reach the host, the filesystem, or the network beyond `127.0.0.1`. A failure inside the state builder is rendered as `{"error": "..."}`; the page still answers, and the failure stays visible rather than turning into an empty panel.
