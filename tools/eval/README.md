# Evaluation harness

`eval_refusal.py` measures refusal rate before/after abliteration or prompt
changes. It uses a keyword heuristic on the first 400 characters (English and
Chinese patterns), and records every response so you can audit false positives.

```bash
python eval_refusal.py --model ./out/qwen-forge --prompts prompts.jsonl --out report.json
```

Prompt file format (JSONL):

```json
{"prompt": "...", "category": "coding"}
{"prompt": "...", "category": "writing"}
```

Report shape:

```json
{"model": "...", "total": 40, "refusal_rate": 0.05,
 "by_category": {"coding": 0.0, "writing": 0.1}, "results": [...]}
```

Use the same prompt set for baseline and candidate runs; do not tune the set
after seeing results. Keep `results` for manual review — the keyword heuristic
is intentionally simple and will misclassify polite non-refusals.
