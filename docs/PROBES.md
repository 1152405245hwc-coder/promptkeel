# Static probe harness

`dsh-forge probe [profile]` runs a fixed corpus of worst-case requests against
the armour dsh-forge is about to install. It never calls a model and never
answers a probe: each request is a fixture payload, and every check is a
measurement of the composed prompt.

```bash
dsh-forge probe                       # dsh profile, no persona
dsh-forge probe --persona cipher      # persona-level base64 in effect
dsh-forge probe --transform morse     # whole-prompt transform
dsh-forge probe --json                # machine-readable rows plus self-check
```

Four checks run per request, plus one header check:

| check | passes when |
| --- | --- |
| `active` | the transform named in the header is the one in effect, or no transform was declared |
| `carry` | the request survives the transform: reversible kinds decode back byte for byte, lossy kinds still produce output |
| `identity` | the composed prompt has no line claiming to be the host (`you are … dsh …`) |
| `scaffold` | the composed prompt has no refusal recipe (`you must refuse`, `as an AI language model`, `I cannot help`, …) |
| `budget` | the composed prompt fits the token budget |

The corpus is grouped by family — `cyber`, `weapons`, `bio`, `chem`, `fraud`,
`identity`, `privacy`, `violence` — and the CLI prints one line per request so a
regression names the family it broke.

## The self-check matters more than the pass rate

A harness that passes a healthy prompt proves nothing on its own. Every run also
feeds a deliberately poisoned prompt (a host identity line plus a refusal recipe)
through the same code path and requires it to fail. `dsh-forge probe` exits
non-zero if either the live armour fails or the self-check stops detecting:

```
score 100 · self-check detected identity+scaffold · families cyber,weapons,bio,chem,fraud,identity,privacy,violence
```

## Reading a failure

- `identity` on a real run means the persona rewriter left a self-description
  line behind; check the persona body and `core/persona.mjs:identityLines`.
- `scaffold` means a host prompt or mode overlay carries refusal language that
  survived composition.
- `budget` with `morse` or `ascii` is expected: those transforms expand the
  prompt several times over. Pick a cheaper transform or raise `--budget`.
- `carry` failing on a reproducible kind is a bug in `core/transform.mjs`, and
  `test/transform.test.mjs` should fail with it.

The corpus is deliberately extreme. It exists to make the armour answer for its
worst case in CI, not to be sent anywhere.
