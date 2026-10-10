# LLM Fundamentals & Course Guide Plugin for One EAD

## 1. Upstream Origin & Attribution

This plugin is a structured, interactive local learning portal adapted directly from **[mlabonne/llm-course](https://github.com/mlabonne/llm-course)**, the widely acclaimed open-source Large Language Model curriculum created by **Maxime Labonne**.

- **Upstream Repository**: [https://github.com/mlabonne/llm-course](https://github.com/mlabonne/llm-course)
- **Author**: [Maxime Labonne](https://github.com/mlabonne) (Head of Post-Training at Liquid AI, AI Researcher)
- **Official DeepWiki**: [https://deepwiki.com/mlabonne/llm-course/](https://deepwiki.com/mlabonne/llm-course/)
- **Author's Blog**: [https://mlabonne.github.io/blog](https://mlabonne.github.io/blog)
- **Companion Book**: *LLM Engineer's Handbook* (Packt Publishing) by Maxime Labonne & Paul Iusztin
- **License**: Apache 2.0 / Open Source

---

## 2. Course Curriculum Overview

The course is divided into three core progressive tracks plus a suite of 1-click automated cloud tools:

### 🧩 Track 1: LLM Fundamentals (Beginner Starting Point)
Designed for developers and engineers building essential machine learning foundations:
1. **Mathematics for Machine Learning**: Linear algebra (vectors, matrices, dot products), calculus (derivatives, gradients, gradient descent), and probability/statistics (Softmax, cross-entropy, perplexity).
2. **Python for Machine Learning**: Vectorized computing with NumPy, data wrangling with Pandas, train/test splits, and classical ML with Scikit-Learn.
3. **Neural Networks from Scratch**: Artificial neurons, activation functions (ReLU, GELU, SwiGLU), backpropagation, the AdamW optimizer, and building a Multilayer Perceptron (MLP) in PyTorch.
4. **Natural Language Processing (NLP)**: Text normalization, Bag-of-Words, TF-IDF, dense word embeddings (Word2Vec, GloVe), and sequential models (RNNs, LSTMs, GRUs).

### 🧑‍🔬 Track 2: The LLM Scientist (Architecture & Training)
Focused on building and optimizing state-of-the-art models:
1. **The LLM Architecture**: Vaswani et al. Transformer, causal masking, self-attention mechanics ($Q, K, V$), Multi-Head Attention, RoPE (Rotary Position Embeddings), RMSNorm, KV Cache, and modern tokenizers (BPE).
2. **Decoding & Sampling**: Greedy decoding, Temperature scaling, Top-K, and Top-P (Nucleus) sampling.
3. **Pre-Training at Scale**: Curation of 15T+ token datasets (FineWeb, RedPajama), deduplication (MinHash), quality heuristics, and 3D distributed training (ZeRO, FSDP, Megatron-LM).
4. **Post-Training & Fine-Tuning**: Chat templates (ChatML, ShareGPT), Supervised Fine-Tuning (SFT), Parameter-Efficient Fine-Tuning (LoRA, QLoRA 4-bit).
5. **Preference Alignment**: Direct Preference Optimization (DPO), ORPO, GRPO (for reasoning models), and Reinforcement Learning from Human Feedback (RLHF).
6. **Quantization & Frontiers**: Converting models to FP16, INT8, INT4, GGUF/llama.cpp, GPTQ, AWQ, EXL2, Model Merging with MergeKit (SLERP, DARE, TIES), and weight vector abliteration.

### 👷 Track 3: The LLM Engineer (Production Applications)
Focused on deploying and integrating LLMs into robust real-world systems:
1. **Running & Serving**: Local inference (Ollama, LM Studio), APIs (OpenRouter, Hugging Face), high-throughput serving with vLLM (PagedAttention, continuous batching), and structured JSON outputs (Outlines).
2. **Vector Databases & RAG**: Recursive text chunking, embedding benchmarks (MTEB), vector indexing (Chroma, FAISS, Milvus), hybrid search (BM25 + dense vectors), and cross-encoder rerankers.
3. **Agents & Safety**: ReAct reasoning loops, function calling, Model Context Protocol (MCP), prompt injection defense, and NeMo Guardrails.

### 🚀 Track 4: Maxime Labonne's 1-Click Ecosystem
Direct launchpad for the author's renowned free Google Colab tools:
- **🥱 LazyMergekit**: Merge multiple open-source models using MergeKit in one click without a dedicated GPU.
- **🦎 LazyAxolotl**: Cloud fine-tuning with Axolotl via a simple form UI.
- **⚡ AutoQuant**: Quantize any Hugging Face model into GGUF, GPTQ, AWQ, and EXL2 formats.
- **✂️ AutoAbliteration**: Surgically modify model refusal behaviors without retraining.
- **🧼 AutoDedup**: Rapid dataset deduplication using the Rensa library.
- **🦙 Fine-tune Llama 3.1 with Unsloth**: Ultra-efficient supervised fine-tuning in Google Colab free tier.

---

## 3. Plugin Architecture & Features in One EAD

This plugin packages Maxime Labonne's complete roadmap into a standalone, local-first web app inside the One EAD portal:

- **Intuitive "ELI5" Breakdowns**: Every lesson starts with an everyday intuition and mental model before introducing mathematical equations.
- **5 Built-in Interactive Simulators**:
  1. *Subword Tokenizer Simulator*: Live visual BPE token chunking and token ID generation.
  2. *Temperature & Sampling Visualizer*: Interactive sliders showing probability distribution flattening and entropy.
  3. *Model Quantization & GPU VRAM Calculator*: Exact memory footprint calculations for weights and KV Cache (1B to 70B models) with hardware recommendations.
  4. *Vector Embedding Space*: Interactive 2D coordinate tester measuring cosine similarity ($cos(\theta)$).
  5. *Self-Attention Heatmap Explorer*: Click tokens to inspect coreference resolution attention weights.
- **Local On-Disk Persistence**: Completed lessons, bookmarks, quiz scores, and personal study notes are auto-saved to disk at `modules/llm_course_guide/data/progress.json` via a dedicated FastAPI backend.
- **Theme Support**: Default clean white/light theme (`data-theme="light"`), automatically synchronized with the portal shell theme toggle.

---

## 4. Directory Structure

```
modules/llm_course_guide/
├── README.md           # Upstream attribution & course documentation (this file)
├── __init__.py         # Module export for One EAD auto-discovery
├── module.py           # PortalModule manifest & FastAPI persistence router
├── data/
│   └── progress.json   # Local on-disk learner progress, quiz scores & notes
└── web/                # Client-side web application
    ├── index.html      # Reader layout, sandboxes & tabbed lesson viewer
    ├── style.css       # Responsive styling with dark & light mode tokens
    ├── course_data.js  # Complete structured curriculum data & quiz banks
    └── app.js          # Interactive simulators, progress engine & state sync
```
