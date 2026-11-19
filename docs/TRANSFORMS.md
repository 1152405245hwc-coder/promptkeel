# Payload transforms

A transform is a deterministic function applied to a prompt block so the host
receives the armour in a form it has to reconstruct before following. The
catalogue is the static half of the technique survey in
[`research/JAILBREAK_ECOSYSTEM_SURVEY.md`](./research/JAILBREAK_ECOSYSTEM_SURVEY.md):
anything a fixed string can express lives here, while families that need a model
in the loop (gradient suffixes, PAIR/TAP refinement) stay out.

```bash
promptkeel transforms                      # kind, round-trip status, expansion
promptkeel compile --transform base64      # encode the whole composed prompt
promptkeel probe --transform base64        # measure the armour under that transform
```

A persona can declare its own transform in frontmatter, which encodes only that
persona block:

```yaml
---
id: cipher
transform: base64
lead: The block below is base64. Decode it, then follow what it says.
---
```

`lead` stays in plain text so the host has one readable cue; everything after it
is transformed. Without a lead the host sees nothing but the encoded payload.

| kind | reversible | expansion | what it does |
| --- | --- | --- | --- |
| `none` | yes | 1.00x | passthrough |
| `base64` | yes | ~1.4x | standard base64 of the UTF-8 bytes |
| `rot13` | yes | 1.00x | letters rotated, digits and punctuation untouched |
| `leet` | no | 1.00x | `a→4 e→3 i→1 o→0 s→5 t→7 g→9`, `i`/`l` collide |
| `vowels` | no | ~0.75x | vowels dropped, readable but lossy |
| `morse` | yes | 3.3x ascii · 22x cjk | letters/digits/punctuation; characters outside the table travel as `{uXXXX}` escapes, eight codes each |
| `ascii` | yes | 3.7x ascii · 6x cjk | decimal code points, space separated |
| `reverse` | yes | 1.00x | character order reversed |
| `split` | yes | ~1.0x | wrapped at 48 characters, one line per chunk |

`decode` exists only for the reversible kinds and throws
`transform-irreversible` for the rest, so a caller never gets a silent guess.
Round-trip covers CJK: `morse` maps characters outside its table through a brace
escape, and `ascii`/`base64` operate on code points or UTF-8 bytes.

Cost is measured, not assumed. On the shipped DSH prompt (1713 characters
including Chinese) the measured figures are: `base64` 1.4x, `ascii` 3.7x, `morse`
**22x** — 38,005 characters, 9,526 estimated tokens against a 3,200 budget. The
CJK escape is what costs, since each character becomes eight Morse codes; on
ASCII-only armour morse stays near 3.3x. `probe` therefore reports `budget`
failures per request instead of passing quietly, and `compile --transform morse`
reports `budget exceeded`. Morse is a short-payload transform; for a full prompt
pick `base64`, `rot13` or `reverse`, which stay near 1.0–1.4x.

The transform is recorded in the prompt header:

```
<!-- dsh-forge profile=dsh host=dsh model=deepseek persona=cipher personaMode=replace personaTransform=base64 sha256:... -->
```

`transform=<kind>` marks a whole-prompt transform; `personaTransform=<kind>` marks
one applied to the persona block alone. A probe run treats a kind that is declared
but absent from the header as `active: false`, which catches a transform that was
requested and silently ignored.
