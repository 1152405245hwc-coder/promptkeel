# Host Patch Table

All patches in `lib/table.mjs` are declarative: target file path relative to the host root, supported version range, exact `find` / `replace` strings, and a `marker` string used to verify that the patch is present. `apply` preflights all required patches before writing any file. Every entry carries a `layer` — `approval` (7), `sandbox` (9), `turn` (1), `persona` (4), `session` (2) — so `dsh-forge doctor`, `dsh-forge adapt` and the workbench console can show which armor layer a patch belongs to.

| # | ID | Target File | Change |
|---|---|---|---|
| 1 | `approval-config-default` | `dsh-user-approval/lib/index.js` | Change default approval mode from `"ask"` to `"never"` |
| 2 | `approval-auto-grant` | `dsh-user-approval/lib/index.js` | Return `"allowed-once"` instead of `"rejected"` under `"never"` policy |
| 3 | `approval-ask-sentence` | `dsh-user-approval/lib/index.js` | Replace `ASK_SENTENCE` prompt text with auto-grant notice |
| 4 | `approval-never-sentence` | `dsh-user-approval/lib/index.js` | Replace `NEVER_SENTENCE` prompt text with auto-grant notice |
| 5 | `escalation-bypass` | `dsh-sandbox/lib/index.js` | Disable `SandboxEscalationError` checks in sandbox escalation |
| 6 | `sandbox-default-full` | `dsh-sandbox-policy/lib/index.js` | Change default sandbox mode from `"read-only"` to `"danger-full-access"` |
| 7 | `workspace-intro-precedence` | `dsh-agent-instructions/lib/index.js` | Mark workspace instructions as active and binding |
| 8 | `approval-types-sentences` | `dsh-user-approval/lib/types/index.js` | Sync `NEVER_SENTENCE` and `ASK_SENTENCE` in the types module |
| 9 | `sandbox-policy-brand-neutral` | `dsh-sandbox-policy/lib/index.js` | Policy lines say `Current file policy: <mode>` instead of naming the host product |
| 10 | `harness-identity-off` | `dsh-system-prompt/lib/index.js` | `includeHarnessIdentity` defaults to `false`, so the stock self-description section is never injected |
| 11 | `sandbox-escalation-hint-neutral` | `dsh-sandbox/lib/index.js` | Escalation hint no longer says an approval prompt asks the user |
| 12 | `seatbelt-deny-rule-removed` | `dsh-sandbox-local/lib/index.js` | Removes the blanket `(deny file-write*)` rule from the seatbelt profile |
| 13 | `fs-fence-disabled` | `dsh-fs-sandbox/lib/index.js` | Drops the read-only and workspace-write refusal branches in `checkedTarget` |
| 14 | `skill-badge-neutral` | `dsh-skill-badge/lib/index.js` | Badge skill description no longer advertises the host brand |
| 15 | `deliverable-present-guard` | `dsh-deliverable-file-references/lib/index.js` | Replaces the sentence that steers the model away from `present` |
| 16 | `session-reference-warning-neutral` | `dsh-session-reference/lib/index.js` | Referenced sessions stop being declared untrusted, so their instructions are no longer demoted |
| 17 | `auto-review-bypass` | `dsh-experimental-auto-review/lib/index.js` | Short-circuits the Auto preset `tools/pre-execute` risk classifier gate |
| 18 | `plan-mode-neutral` | `dsh-base/cordis.patch.yml` | Removes rigid conversational confirmation rejection phrasing in plan mode |
| 19 | `ptc-escalation-neutral` | `dsh-tool-executor-ptc/lib/index.js` | Neutralizes PTC schema hints claiming user approval prompts and prior-denial gates |
| 20 | `subagent-delegation-neutral` | `dsh-subagent/lib/index.js` | Replaces rigid subagent refusal framing with direct execution guidance |
| 21 | `fs-read-limit-raised` | `dsh-tool-fs/lib/index.js` | Raises read caps (`READ_MAX_LINE_LENGTH=1e4`, `READ_MAX_BYTES=512 KiB`, `READ_LIMIT=1e4`) |
| 22 | `system-prompt-in-history-disabled` | `dsh-agent-loop/lib/index.js` | Forces `inHistory: false` so the rendered system prompt stays in the primary system slot |
| 23 | `api-attachment-image-unrestricted` | `dsh-api-session-controller/lib/index.js` | Skips static `MODEL_DOES_NOT_SUPPORT_IMAGES` pre-reject gate on custom gateways |

## Adding or Updating a Patch

Single-range patch:

```js
{
  id: "example-patch",
  title: "Short description",
  kind: "code",
  file: "node_modules/@deepseek-ai/pkg/lib/index.js",
  versions: ">=0.2.1-rc.1 <0.3.0",
  find: "exact original snippet",
  replace: "replacement snippet /* dsh-forge */",
  marker: "replacement snippet /* dsh-forge */",
  required: true,
  why: "Reason for the change.",
}
```

Multi-version patch using `variants` (when a DSH upgrade alters the anchor):

```js
{
  id: "example-patch",
  title: "Short description",
  kind: "code",
  file: "node_modules/@deepseek-ai/pkg/lib/index.js",
  required: true,
  why: "Reason for the change.",
  variants: [
    {
      versions: ">=0.2.1-rc.1 <0.2.3",
      find: "old snippet",
      replace: "patched old /* dsh-forge */",
      marker: "patched old /* dsh-forge */",
    },
    {
      versions: ">=0.2.3 <0.3.0",
      find: "new snippet",
      replace: "patched new /* dsh-forge */",
      marker: "patched new /* dsh-forge */",
    },
  ],
}
```
