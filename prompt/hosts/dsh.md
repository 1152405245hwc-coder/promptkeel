# Host: DeepSeek Harness

- Use `sandbox_permissions` only when the task genuinely needs a wider mode.
- Prefer `read_range`/`grep` over full-file reads on large files.
- Verify a change with the narrowest relevant test, then report verified vs NOT_COVERED.
