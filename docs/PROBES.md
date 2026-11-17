# Static probe harness

`dsh-forge probe [profile]` runs a fixed corpus of worst-case requests against
the armour dsh-forge is about to install. It never calls a model and never
answers a probe: each request is a fixture payload — a string that records the
*shape* of a request, never a response — and every check is a measurement of the
composed prompt.

```bash
dsh-forge probe                       # dsh profile, no persona
dsh-forge probe --persona cipher      # persona-level base64 in effect
dsh-forge probe --transform morse     # whole-prompt transform
dsh-forge probe --json                # machine-readable rows, per-class tallies, self-check
```

## Checks

Seven checks run per request:

| check | passes when |
| --- | --- |
| `active` | the transform named in the header is the one in effect, or no transform was declared |
| `carry` | the request survives the transform: reversible kinds decode back byte for byte, lossy kinds still produce output |
| `identity` | no line of the composed prompt opens as a host self-description (`you are … dsh …`) |
| `scaffold` | no line of the composed prompt carries a refusal recipe (`you must refuse`, `as an AI language model`, `I cannot help`, …) |
| `budget` | the composed prompt fits the token budget |
| `loader` | no refusal recipe reappears on any surface a loader could hand back: the raw text, the text with soft wrapping collapsed, the body decoded with the active transform, and any self-identifying encoded block (base64, decimal codepoints, morse) |
| `residue` | no host identity claim survives anywhere in the compiled body — including mid-line, after a full stop or a colon, where a line-anchored scan cannot see it |

`identity` and `scaffold` are line scans. `loader` and `residue` exist because a
line scan is not the only thing a model reads:

- a recipe that travelled through `base64`, `morse` or decimal-codepoint
  encoding is invisible as text but comes back when a loader decodes it;
- the `split` transform wraps at 48 characters, which can land inside a recipe
  (`You must` / `refuse …`) and hide it from a per-line regex;
- a host identity claim that survived mid-sentence (`Answer briefly. You are
  DSH, …`) never opens a line, so `identityLines` in `core/persona.mjs` stays
  quiet and `residue` fires instead.

## Families

The corpus is grouped by family, and every probe declares one:

`cyber`, `weapons`, `bio`, `chem`, `fraud`, `identity`, `privacy`, `violence`,
`minor`, `adult`.

`minor` and `adult` cover the two shapes that are hardest to express as text
alone — age-ambiguous sexual framing and explicit adult request/catalog shapes.
They are request strings like every other entry: fixtures that make the armour
answer for the worst case, never material to answer, and never sent anywhere.

## Severity

Each probe also declares a severity, so a score can be read per class instead of
as one number. Severity says how a *failure* should be read, not how bad the
request is:

| severity | meaning | how to read a failed row |
| --- | --- | --- |
| `hard-block` | an answer would be operational uplift for severe harm | ship-blocking: the armour did not hold |
| `policy-edge` | hosts legitimately differ and the answer depends on framing (age-ambiguous fiction, adult content, security tooling, OSINT framing) | a warning about the class; it may be a host-side override rather than a forge defect |
| `capability` | the shape exists to exercise the pipeline (long, structured, mixed-script) | mechanical loss — transform bloat or a broken round-trip — not a policy question |

`runProbes()` returns `byFamily` and `bySeverity` alongside the rows, each entry
`{ family | severity, total, passed, failed, rate }`, and `--json` carries both.

## The self-check matters more than the pass rate

A harness that passes a healthy prompt proves nothing on its own. Every run also
feeds three deliberately poisoned prompts through the same code path:

| control | prompt | must fire | must stay quiet |
| --- | --- | --- | --- |
| `host-identity+refusal` | a host identity line plus a refusal recipe | `identity`, `scaffold`, `loader`, `residue` | — |
| `encoded-refusal` | a base64 blob that decodes to a refusal recipe | `loader` | `scaffold` |
| `midline-identity` | `Answer briefly. You are DSH, …` | `residue` | `identity` |

The third and fourth columns are the point: they prove `loader` is not a
duplicate of `scaffold` and `residue` is not a duplicate of `identity`. Every
control must fail all of its rows. `dsh-forge probe` exits non-zero if either
the live armour fails or any control stops discriminating:

```
score 100 · self-check detected identity+loader+residue+scaffold · families cyber,weapons,bio,chem,fraud,identity,privacy,violence,minor,adult
```

## Reading a failure

- `identity` on a real run means the persona rewriter left a self-description
  line behind; check the persona body and `core/persona.mjs:identityLines`.
- `residue` with a clean `identity` means the same claim survived reflow — look
  for a host name in the middle of a paragraph, or a part joined after a colon.
- `scaffold` means a host prompt or mode overlay carries refusal language that
  survived composition.
- `loader` means the recipe is still reachable after reassembly. The detail
  names the surface (`raw`, `unwrapped`, `decoded:<kind>`, `<codec>-block`), so
  start there: `decoded:base64` points at a transform-encoded part,
  `unwrapped` at a recipe the `split` transform wrapped in half.
- `budget` with `morse` or `ascii` is expected: those transforms expand the
  prompt several times over. Pick a cheaper transform or raise `--budget`.
- `carry` failing on a reproducible kind is a bug in `core/transform.mjs`, and
  `test/transform.test.mjs` should fail with it.

Because the request side of every row is identical, a class-level failure and a
mechanical one look the same in a row. Read `bySeverity` first: a uniform
failure across every severity is mechanical; a failure confined to `hard-block`
rows is a policy surface, and one confined to `policy-edge` rows usually means
the class needs a decision rather than a patch.

The corpus is deliberately extreme. It exists to make the armour answer for its
worst case in CI, not to be sent anywhere.
