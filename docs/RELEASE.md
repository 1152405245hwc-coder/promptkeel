# Release Runbook

Every release goes through the same five gates, in this order. A gate that fails stops the
release; nothing is published from a tree that has not passed all of them.

| Gate | Command | What it decides |
| :--- | :--- | :--- |
| tests | `npm test` | Behaviour of every module, including the fixtures that reproduce endpoint failure modes |
| repository | `npm run check:repo` | Layering boundary, syntax, lockfile metadata, privacy, package contents, diff hygiene |
| docs | `npm run docs:check` | Every quoted figure in `docs/` and `README.md` still matches the tree |
| profiles | `npm run verify:profiles` | Every profile and model compiles inside the prompt budget |
| publication | `npm run release:check` | No local path or identity leaves in the tarball |

`npm run release:check` is the last gate on purpose: it packs the real tarball, so it catches
a stray file that the other gates never inspect.

## Cutting a version

```bash
node scripts/bump_version.mjs 0.2.1     # package.json, package-lock.json, lib/paths.mjs
node scripts/bump_version.mjs 0.2.1     # second run must report "already 0.2.1"
```

Only three files carry an authoritative version. Profile and model files carry their own
content version (`forge.profile/v1` payloads); changing them because the package moved would
claim a content change that did not happen.

Then:

1. Rewrite the top `CHANGELOG.md` section: replace `## [Unreleased]` with `## [<version>] - <date>`
   and lead with what a user of the previous version has to know — one paragraph, plus upgrade
   notes for anything that moved or disappeared.
2. Run the five gates.
3. `git tag -a v<version> -m "v<version>"`, then push the tag with the branch.
4. `npm publish --access public` (see the name decision below).
5. Paste the changelog section as the release body.

`npm run check:repo` fails if `CHANGELOG.md` has no section for the current `package.json`
version, so a bump that forgets the changelog cannot be tagged.

## Publication name

`dsh-forge` was taken on the public npm registry (`0.0.1` by an unrelated account) and on GitHub, so this package ships as **`dsh-forge-kit`**:

- Package name (`package.json` & `package-lock.json`): `dsh-forge-kit`
- Cordis plugin ID (`cordis.patch.yml`, `lib/preset.mjs`, `lib/index.js`, `client/src/entry.js`): `dsh-forge-kit` (legacy `dsh-forge` node is disabled in `cordis.patch.yml` and auto-migrated by `dsh-forge profile enable`)
- Loopback API route: `/dsh-forge-kit/api`
- State roots: `~/.dsh-forge-kit/` (`$XDG_STATE_HOME/dsh-forge-kit`, `DSH_FORGE_KIT_STATE` with `DSH_FORGE_STATE` fallback) and `~/.dsh/dsh-forge-kit/`
- Binaries: `dsh-forge-kit`, `dsh-forge`, `dsh-session`
- Included files: `docs/research/` snapshots and offline Python `tools/` stay in Git for local/CI verification (`npm run verify`) and are excluded from the published npm tarball.

## What must not ship

- Anything under `.dsh-forge-state/`, `node_modules/`, or a packed `.tgz`.
- Local absolute paths, home directories, or noreply identities — `release:check` scans every
  packed text file for these.
- Generated client bundles that no longer match `client/src/`: run `npm run build:client` and
  commit the result, or `check:repo` fails on the mismatch.
- Measured numbers that were never measured. `docs/MEASUREMENT_RULES.md` lists the conditions a
  published run has to satisfy; a figure that cannot name its sample size belongs in a research
  note, not in a document a user reads as fact.

## Rollback

The package ships no migration that runs on install, so a bad release is rolled back by
publishing a higher patch version with the previous behaviour. Host-side state is untouched:
`dsh-forge revert` restores patched host files from the manifest written at apply time, and
session files under the state root are plain JSON that stays readable across versions.
