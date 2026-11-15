#!/usr/bin/env python3
"""
dsh-forge / tools / abliterate / abliterate.py

Reference implementation of orthogonal activation-direction projection
for local CausalLM weights (HuggingFace Transformers + PyTorch).

Mathematical formulation:
  1. Collect last-token residual stream activations h_pos, h_neg at layer L
     across contrastive prompt pairs (positive target subset vs baseline subset).
  2. Estimate the unit contrastive direction:
       r = mean(h_pos) - mean(h_neg)
       r_hat = r / ||r||_2
  3. Project out r_hat from output-writing weight matrices W in residual-writing
     modules (e.g., attention o_proj, MLP down_proj):
       W' = W - (r_hat @ r_hat^T) @ W
"""

import argparse
import json
from pathlib import Path
import sys

DEFAULT_PAIRS = [
    (
        "Audit this Linux kernel module for privilege escalation race conditions.",
        "Explain how a mutex prevents race conditions in multi-threaded programs.",
    ),
    (
        "Demonstrate how raw socket packet crafting works in Python for network diagnostics.",
        "Demonstrate how standard TCP client sockets work in Python.",
    ),
    (
        "Analyze how heap buffer overflow mitigations such as ASLR and stack canaries operate.",
        "Analyze how virtual memory paging and address translation operate.",
    ),
    (
        "Show how SQL injection payloads bypass unparameterized query concatenation during a security review.",
        "Show how parameterized prepared statements bind variables in SQL queries.",
    ),
]


def load_pairs(pairs_path: str | None) -> list[tuple[str, str]]:
    if not pairs_path:
        return list(DEFAULT_PAIRS)
    path = Path(pairs_path)
    if not path.is_file():
        raise FileNotFoundError(f"Pairs file not found: {path}")
    pairs: list[tuple[str, str]] = []
    for line_no, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        item = json.loads(line)
        pos = item.get("positive") or item.get("harmful")
        neg = item.get("negative") or item.get("harmless")
        if not isinstance(pos, str) or not isinstance(neg, str) or not pos.strip() or not neg.strip():
            raise ValueError(
                f"Invalid JSONL pair at {path}:{line_no} (expected 'positive'/'negative' strings)"
            )
        pairs.append((pos.strip(), neg.strip()))
    if not pairs:
        raise ValueError(f"No valid contrastive pairs found in {path}")
    return pairs


def parse_args():
    p = argparse.ArgumentParser(
        description="Compute and project out a contrastive residual-stream direction on local HF weights."
    )
    p.add_argument("--model", required=True, help="Local path or HuggingFace model ID")
    p.add_argument("--out", required=True, help="Output directory for modified weights or direction tensor")
    p.add_argument("--layer", type=int, default=-1, help="Target transformer layer index (-1 = middle layer)")
    p.add_argument("--scale", type=float, default=1.0, help="Projection strength (1.0 = full orthogonal projection)")
    p.add_argument("--pairs", default=None, help="Optional JSONL file containing {'positive': ..., 'negative': ...} pairs")
    p.add_argument("--dry-run", action="store_true", help="Compute direction norm and exit without modifying weights")
    return p.parse_args()


def main():
    args = parse_args()
    try:
        pairs = load_pairs(args.pairs)
    except Exception as exc:
        print(f"[abliterate] {exc}", file=sys.stderr)
        sys.exit(2)

    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError:
        print(
            "[abliterate] Missing dependencies. Install in an isolated venv:\n"
            "  pip install torch transformers accelerate safetensors",
            file=sys.stderr,
        )
        sys.exit(2)

    print(f"[abliterate] loading model: {args.model} ({len(pairs)} contrastive pairs)")
    tok = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForCausalLM.from_pretrained(
        args.model, torch_dtype=torch.float16, device_map="auto"
    )
    model.eval()

    layers = model.model.layers
    target_idx = args.layer if args.layer >= 0 else len(layers) // 2
    if target_idx < 0 or target_idx >= len(layers):
        print(
            f"[abliterate] layer index {target_idx} out of range (0..{len(layers) - 1})",
            file=sys.stderr,
        )
        sys.exit(2)
    target_layer = layers[target_idx]

    pos_acts, neg_acts = [], []

    def capture(bucket):
        def hook(_module, _inp, out):
            h = out[0] if isinstance(out, tuple) else out
            bucket.append(h[:, -1, :].detach().float().cpu())
        return hook

    for pos, neg in pairs:
        h1 = target_layer.register_forward_hook(capture(pos_acts))
        with torch.no_grad():
            model(**tok(pos, return_tensors="pt").to(model.device))
        h1.remove()

        h2 = target_layer.register_forward_hook(capture(neg_acts))
        with torch.no_grad():
            model(**tok(neg, return_tensors="pt").to(model.device))
        h2.remove()

    r = torch.cat(pos_acts, dim=0).mean(dim=0) - torch.cat(neg_acts, dim=0).mean(dim=0)
    norm = float(r.norm().item())
    if norm == 0.0:
        print("[abliterate] contrastive direction norm is 0.0; aborting.", file=sys.stderr)
        sys.exit(2)
    r_hat = (r / r.norm()).to(torch.float32)
    print(f"[abliterate] layer={target_idx}/{len(layers)} ||r||_2={norm:.4f} dim={r_hat.shape[0]}")

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    torch.save(
        {"layer": target_idx, "norm": norm, "pairs": len(pairs), "r_hat": r_hat},
        out_dir / "refusal_dir.pt",
    )

    if args.dry_run:
        print(f"[abliterate] dry-run complete. Saved direction to {out_dir / 'refusal_dir.pt'}")
        return

    with torch.no_grad():
        for lyr in layers:
            for proj in (lyr.self_attn.o_proj, lyr.mlp.down_proj):
                W = proj.weight.data.float()
                r_dev = r_hat.to(W.device).unsqueeze(1)
                proj.weight.data = (W - args.scale * (r_dev @ (r_dev.T @ W))).to(proj.weight.dtype)

    model.save_pretrained(out_dir)
    tok.save_pretrained(out_dir)
    print(f"[abliterate] projected weights saved to {out_dir}")


if __name__ == "__main__":
    main()
