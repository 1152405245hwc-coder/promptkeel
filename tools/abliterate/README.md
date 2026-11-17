# Weight-Space Residual Stream Projection (`tools/abliterate`)

Whereas `dsh-forge` operates at the **host & prompt governance layer**, `tools/abliterate/` operates at the **local model weight layer** (paired with the `local` model overlay in `models/local.json`) for open-weight models (`DeepSeek-R1-Distill-*`, `Qwen2.5-*`, `Llama-3.*`) running under Ollama, `llama.cpp`, or vLLM.

## Mathematical Formulation

Given contrastive prompt pairs $\{(x_i^+, x_i^-)\}_{i=1}^N$ (for example, false-positive security/audit prompts versus routine baseline prompts):

1. Extract the last-token residual stream activations $h_L(x_i^+), h_L(x_i^-) \in \mathbb{R}^{d_{\text{model}}}$ at middle transformer layer $L = \lfloor n_{\text{layers}} / 2 \rfloor$.
2. Compute the unit contrastive direction:
   $$r = \frac{1}{N}\sum_{i=1}^N h_L(x_i^+) - \frac{1}{N}\sum_{i=1}^N h_L(x_i^-), \qquad \hat{r} = \frac{r}{\|r\|_2}$$
3. Orthogonalize every residual-writing projection matrix $W \in \{W_{\text{o\_proj}}, W_{\text{down\_proj}}\}$ across layers:
   $$W' = W - \alpha (\hat{r}\hat{r}^\top) W$$

## Usage

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install torch transformers accelerate safetensors

# 1. Dry-run: compute direction norm and save refusal_dir.pt without modifying weights
python3 tools/abliterate/abliterate.py \
  --model deepseek-ai/DeepSeek-R1-Distill-Qwen-7B \
  --out ./out/r1-7b-abliterated \
  --dry-run

# 2. Custom contrastive pairs via JSONL (each line: {"positive": "...", "negative": "..."})
python3 tools/abliterate/abliterate.py \
  --model deepseek-ai/DeepSeek-R1-Distill-Qwen-7B \
  --pairs ./my-calibration-pairs.jsonl \
  --out ./out/r1-7b-abliterated \
  --scale 1.0
```
