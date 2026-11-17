# Research Index

All design and empirical background documents under `docs/research/`:

| File | Scope | Status |
| --- | --- | --- |
| [JAILBREAK_PRINCIPLES.md](JAILBREAK_PRINCIPLES.md) | Structural hierarchy of refusal layers (system, alignment, turn, provider filters) | Reference |
| [JAILBREAK_ECOSYSTEM_SURVEY.md](JAILBREAK_ECOSYSTEM_SURVEY.md) | Survey of jailbreak transforms, encoding vectors, and multi-turn strategies | Reference |
| [MULTIPLATFORM_DESIGN.md](MULTIPLATFORM_DESIGN.md) | Config hierarchy and precedence across Claude Code, Codex, Gemini CLI, OpenCode | Reference |
| [MULTIPLATFORM_PROJECTS.md](MULTIPLATFORM_PROJECTS.md) | Survey of open-source multi-agent/host prompt injectors | Reference |
| [PLATFORM_BREAKOUT_MATRIX.md](PLATFORM_BREAKOUT_MATRIX.md) | Host-by-host ceiling analysis (`replace-full` vs `append-only` vs `unobservable`) | Implemented (`B4` targets) |
| [BREAKOUT_PATCH_MATRIX.md](BREAKOUT_PATCH_MATRIX.md) | Candidate DSH runtime patch inventory vs `0.2.2-rc.x` package layout | Verified (`23/23` patches) |
| [PERSONA_CHANNEL_DESIGN.md](PERSONA_CHANNEL_DESIGN.md) | Delivery channel taxonomy (`project`, `install`, `shim`, `slash`, `none`) and timings | Implemented |
| [CROSS_PLATFORM_AUDIT.md](CROSS_PLATFORM_AUDIT.md) | Cross-platform portability gaps, path redaction, and backup determinism | Implemented |
| [PER_MODEL_PROMPTS.md](PER_MODEL_PROMPTS.md) | Provider system prompt differences across DeepSeek, GLM, Claude, GPT, Gemini, Qwen | Implemented (`models/`) |
| [LINUXDO_FIELD_NOTES.md](LINUXDO_FIELD_NOTES.md) | Community field observations on model chain-of-thought sensitivity and prompt framing | Reference |
