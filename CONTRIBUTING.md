# Contributing to PromptKeel

Thank you for helping improve **PromptKeel (龙骨)**.

Before making changes, read:
- [docs/ONBOARDING.md](docs/ONBOARDING.md) — 30-minute walkthrough and `core/` vs. `lib/` module boundary
- [docs/ENGINEERING_RULES.md](docs/ENGINEERING_RULES.md) — anti-regression guardrails
- [docs/MEASUREMENT_RULES.md](docs/MEASUREMENT_RULES.md) — rules for publishing any live evaluation numbers

## Development Setup

PromptKeel has **zero runtime and dev dependencies**. You only need **Node.js `>=20`** (`git` and `bash`; plus `python3` for `npm run verify` AST checks).

```bash
git clone https://github.com/liangsiweiethan-wq/promptkeel.git
cd promptkeel
npm test
```

## Engineering Invariants

1. **Zero layering leaks:** Never import `lib/` from `core/`.
2. **Budget gate:** Every profile and model combination must compile strictly under `480` tokens (`npm run verify:profiles`).
3. **Wire verification:** Any change to session state, transport degradation, gateway classifiers, or request packing requires an HTTP fixture E2E test in [test/session-e2e.test.mjs](test/session-e2e.test.mjs).
4. **Golden host fixtures:** Any change to the 4 verified primary hosts (`dsh`, `claude-code`, `codex`, `opencode`) must keep fixtures in [test/fixtures/hosts/](test/fixtures/hosts/) covering `missing`, `configured`, `active`, and false-positive cases.
5. **Privacy & clean packaging:** Never commit absolute local home paths, email addresses, credentials, UUIDs, or PNG metadata chunks (`npm run release:check`).

## Pull Request Checklist

If you modify `client/src/entry.js`, rebuild the client bundle first (`npm run build:client`). If you alter patches, profiles, models, or personas, run `node scripts/check_docs.mjs`. Then run all gates:

```bash
npm test
npm run check:repo
npm run docs:check
npm run verify:profiles
npm run verify
npm run release:check
```

Use small, single-concern commits and open a pull request against `main`.
