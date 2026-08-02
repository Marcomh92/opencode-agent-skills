# Semantic Matching

## Purpose

The Semantic Matching subsystem automatically suggests relevant skills to the AI agent by computing semantic similarity between user messages and skill descriptions using transformer-based text embeddings.

## Boundaries

### In Scope

- Text embedding generation using `all-MiniLM-L6-v2`
- Embedding disk caching (SHA256-based)
- Cosine similarity computation
- Top-K skill matching with threshold filtering
- Precomputation of skill embeddings at plugin startup

### Out of Scope

- Skill discovery (handled by `src/skills.ts`)
- Injecting matched skills into context (handled by `src/plugin.ts`)
- Training or fine-tuning models
- Alternative matching strategies (regex, keyword)

## High-Level Flow

1. **Model Loading** (`src/embeddings.ts`, `ensureModel`)
   - Lazily loads `Xenova/all-MiniLM-L6-v2` with q8 quantization
   - Applies `HF_ENDPOINT` environment variable for mirror support
   - Model is singleton, shared across all calls

2. **Precomputation** (`precomputeSkillEmbeddings`)
   - Called at plugin startup with all discovered skills
   - Generates embeddings asynchronously (non-blocking)
   - Warms the disk cache for subsequent matching

3. **User Message Matching** (`matchSkills`)
   - Generates embedding for user message text
   - For each skill, loads/generates embedding for description
   - Computes cosine similarity between query and skill embeddings
   - Filters by threshold (default 0.35)
   - Returns top-K matches (default 5), sorted by score

4. **Cache Management** (`getEmbedding`)
   - Computes SHA256 of input text
   - Checks disk cache in `~/.cache/opencode-agent-skills/embeddings/`
   - Returns cached embedding if found
   - Generates new embedding, saves to cache, returns it

## Data Model

| Entity | Purpose | Source |
|--------|---------|--------|
| `Float32Array` | Embedding vector (384 dimensions) | `src/embeddings.ts` |
| `SkillSummary` | Input for matching (name + description) | `src/skills.ts` |

## External Contracts

### Inputs

| Source | Data | Trigger |
|--------|------|---------|
| Plugin Core | User message text | Every non-initial message |
| Plugin Core | `SkillSummary[]` | Plugin startup (precomputation) |
| Hugging Face | Model weights | First embedding request |

### Outputs

| Destination | Data | Trigger |
|-------------|------|---------|
| Plugin Core | `SkillSummary[]` (matched skills) | After similarity computation |
| Disk cache | Binary embedding files | After new embedding generation |

## Invariants

- **INV-001:** All embeddings are 384-dimensional Float32Arrays.
- **INV-002:** All embeddings are L2-normalized (magnitude ≈ 1.0).
- **INV-003:** Embedding cache keys are SHA256 hashes of the input text.
- **INV-004:** Cosine similarity ranges from -1.0 to 1.0; only values ≥ 0.35 are returned.
- **INV-005:** At most 5 skills are returned per match call.

## Dependencies

### This Subsystem Depends On

- `@huggingface/transformers` — for model loading and inference
- `node:crypto` — for SHA256 hashing
- `node:fs/promises` — for cache I/O
- `src/skills.ts` — for `SkillSummary` type

### Other Subsystems Depending On This

- `src/plugin.ts` — calls `matchSkills` on user messages and `precomputeSkillEmbeddings` at startup

## Constraints

- **Performance:** First embedding generation takes 1-2s (model load). Subsequent cached embeddings are near-instant.
- **Memory:** Model uses ~100MB RAM when loaded.
- **Disk:** Cache is unbounded; users may need to manually clear `~/.cache/opencode-agent-skills/embeddings/`.
- **Offline:** Requires internet on first run to download model weights. Subsequent runs can be offline if cache is warm.
- **Network:** Supports `HF_ENDPOINT` environment variable for users in restricted networks.
