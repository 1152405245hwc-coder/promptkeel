# Measurement Rules

These rules exist because the project already paid for them. Each one is
traceable to a commit that had to retract or correct a published claim.
They apply to `docs/PLAYBOOK.md`, `docs/LIVE_MATRIX.md`,
`docs/EXTREME_TEST_REPORT.md`, and any future run report.

## 1. One sample is an observation, not a result

A single run may be reported as "observed", never as a comparison or a
recommendation. Comparative claims require `n >= 3` per cell, with every
sample retained in the run directory.

- Cost of ignoring: `5b5e752` ("a single sample flips the conclusion") forced
  `d06bdbf` to re-run every cell `n` times.

## 2. Stamp the classifier with the result

Every `results.jsonl` / `summary.json` records the classifier version (or
rubric hash) that produced it. When the classifier changes, prior numbers are
invalidated: re-run both arms before comparing.

- Cost of ignoring: `69f2871` published "three turns beat one by 2.5x", then
  `cd4db48` retracted it — the fixed classifier made the two arms tie.

## 3. Keep the four outcomes separate

`refused` / `blocked` / `empty` / `compliant` are different states. Never fold
`blocked` or `empty` into `refused`, and never count a staged or partial
refusal as delivery.

- Cost of ignoring: `704ac48` ("stop counting blunt and staged refusals as
  delivery").

## 4. Interleave arms in the same time window

Compare strategies by alternating them within one run window. Never compare a
morning arm against an evening arm.

- Cost of ignoring: `aa1b6a8` added interleaving specifically because
  hour-to-hour drift could pick the winner.

## 5. Empty content means "look again", not "blocked"

Before classifying a 200-with-no-text as a refusal, check the reasoning-token
budget. Starved reasoners return empty bodies. Raise the budget and retry
before recording a verdict.

- Cost of ignoring: `5c3e47f` ("correct the empty-content claim: the reasoner
  was starved, not blocked").

## 6. Retract in public, never rewrite

A retracted claim stays in the document with a dated retraction line naming
the reason and the superseding number. Silent edits destroy the audit trail
that makes the remaining numbers credible.

## 7. Every quantitative claim carries a reproduction block

Each table or headline number is followed by the command that produced it and
the run id or log path. If it cannot be reproduced from the repository, it is
an anecdote and must be labelled as one.

## 8. Change one variable per comparison

Prompt, transform, turn count, model, and sampling temperature are separate
variables. A run that changes two of them cannot attribute the difference.

## Enforcement

- Reviewers reject any `docs/` change that adds a comparative number without
  rules 1, 2, and 7.
- `npm run check:repo` keeps the surrounding hygiene gates green; this file is
  the human-review half that a script cannot judge.
- When a new class of measurement mistake is found, add a rule here in the same
  commit that fixes the code, so the cost is paid once.
