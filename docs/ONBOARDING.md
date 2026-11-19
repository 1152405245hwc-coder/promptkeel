# Engineer Onboarding (30-Minute Ramp-Up)

`promptkeel` (**PromptKeel / 龙骨**) is a **deterministic prompt/policy compiler + transactional executor + persistent adaptive session runtime** (`Node >= 20`, zero runtime npm dependencies).

## 1. Mental Model & Layering (5 min)

```text
bin/promptkeel.js + bin/commands/{shared,dsh,plan,runtime}.mjs  ──▶ CLI dispatch (`promptkeel` / compat `dsh-forge` + `session`)
bin/promptkeel-session.js                                         ──▶ Persistent session CLI (`promptkeel-session` / compat `dsh-session`)
core/                                                           ──▶ Host-neutral public API (`core/index.mjs`)
  ├── contract, prompt, compile, persona, transform, probe      ──▶ Pure policy compiler (< 480 tok ceiling)
  ├── executor, batch, channels, grades, shim, audit, snapshot  ──▶ Transactional file writer & rollback
  └── strategy, families, session, gateway, console, net        ──▶ Adaptive sessions, HTTP gateway & :7788 UI
hosts/                                                          ──▶ Adapter registry + session evidence detectors
lib/                                                            ──▶ DSH-NATIVE ONLY (23 patches, ASAR, Cordis plugin)
```

> **Naming gotcha:** `lib/` is DSH-specific host runtime code, **not** a generic shared library. See [lib/README.md](../lib/README.md).
> **Hard boundary:** `core/` must never import `lib/`. Enforced by `scripts/check_repo.sh`.

## 2. Dual-Track State Layout (5 min)

Runtime files are split cleanly by ownership so testing never pollutes your live `~/.dsh/` config:

```text
~/.dsh/
  ├── prompt-inject.md                  # DSH prompt channel (`promptkeel prompt install`)
  └── promptkeel/                       # DSH-native state (`DSH_HOME`)
      ├── backups/<id>/manifest.json    # DSH patch backups + sha256
      ├── logs/forge-YYYYMMDD.jsonl
      └── preset.json

~/.promptkeel/                          # Cross-host & session state (`--state` or `PROMPTKEEL_STATE`)
  ├── plans/<id>/manifest.json          # Cross-host transactional backups & revert manifests
  ├── snapshots/                        # Pruned prompt snapshots
  └── sessions/
      ├── s-<id>.json                   # Persistent session turns, verdicts, systemMode, shape
      └── _family-<family>.json         # Cross-session UCB1 arm priors
```

## 3. Verified vs. Frozen Hosts (5 min)

- **4 Verified Primary Hosts:** `dsh`, `claude-code`, `codex`, `opencode`. Each has golden detection fixtures under [test/fixtures/hosts/](../test/fixtures/hosts/) covering `missing` / `configured` / `active` states and end-to-end compile/apply/verify/revert coverage.
- **9 Frozen / Experimental Profiles:** `gemini`, `continue`, `cursor`, `windsurf`, `aider`, `hermes`, `openclaw`, `muse`, `generic`. Still compile inside budget, but host activation remains configuration-only or frozen.

## 4. Local Verification Loop (5 min)

Run these commands after any change:

```bash
npm test                  # Unit, security, ASAR, CLI, golden host fixtures, HTTP fixture E2E (~2s)
npm run verify:profiles   # Compile all 13 profiles under the 480-token ceiling
npm run check:repo        # Layering boundary, CLI surface, syntax, lockfile, privacy, tarball contents
npm run docs:check        # Verify quoted numbers match lib/table.mjs & profiles/
npm run verify            # Full gate: tests + client build + Python AST + anchor drift + privacy
npm run release:check     # Git history author/privacy scan + clean npm pack tarball check
```

## 5. Common Tasks (10 min)

- **Inspect/compile a plan without writing:** `node bin/promptkeel.js compile codex --model gpt --mode coding`
- **Add or update a primary host detector:** add synthetic state directories under `test/fixtures/hosts/<host>/` and assert all lifecycle states in `test/host-fixtures.test.mjs`.
- **Add or fix a session/transport rule:** test the real wire protocol against an in-process `http.createServer` fixture in `test/session-e2e.test.mjs` — never trust unit mocks of pure functions alone.
- **Read next:** [ARCHITECTURE.md](ARCHITECTURE.md), [ENGINEERING_RULES.md](ENGINEERING_RULES.md), [MEASUREMENT_RULES.md](MEASUREMENT_RULES.md), [SESSION.md](SESSION.md).
