# Semantic Matching

## Purpose

The Semantic Matching subsystem provides text-embedding-based similarity between skill descriptions and arbitrary input text, using transformer-based embeddings (quantized `all-MiniLM-L6-v2`). It supports two operations: precomputing skill description embeddings at plugin startup, and computing on-demand similarity against a user-provided text.

The per-message chat handler invokes this subsystem via `matchSkills(...)` and injects a `<relevant-skills>` block for matches. The injection replaces the earlier `<skill-evaluation-required>` block that was disabled because the prompt primed models to narrate skill decisions and the embedding-only match over short descriptions produced too many false positives. See `docs/features/PLUGIN_CORE.md` for the new injection contract and `CHANGELOG.md` for the migration entry.

## Boundaries

### In Scope

- Text embedding generation using `all-MiniLM-L6-v2`
- Embedding disk caching (SHA256-based), version-namespaced under `embeddings/v2/`
- Cosine similarity computation
- Top-K skill matching with threshold + margin filtering
- Precomputation of skill embeddings at plugin startup
- One-time prune of legacy (pre-`v2`) embedding cache files at startup

### Out of Scope

- Skill discovery (handled by `src/skills.ts`)
- Block stripping before matching (handled by `src/strip-patterns.ts` and `src/plugin.ts`)
- Per-message prompt rendering (handled by `formatRelevantSkillsInjection` in `src/plugin.ts`)
- Training or fine-tuning models
- Alternative matching strategies (regex, keyword)

## High-Level Flow

1. **Model Loading** (`src/embeddings.ts`, `ensureModel`)
   - Lazily loads `Xenova/all-MiniLM-L6-v2` with q8 quantization
   - Applies `HF_ENDPOINT` environment variable for mirror support
   - Model is singleton, shared across all calls

2. **Precomputation** (`precomputeSkillEmbeddings`)
   - Called at plugin startup with all discovered skills (filtered by `globalPermissions`)
   - Generates embeddings asynchronously (non-blocking)
   - Warms the disk cache so description embeddings are ready on the per-message path

3. **Skill Matching** (`matchSkills`)
   - Receives the user message (already stripped of system-injected blocks) and the agent-filtered `SkillSummary[]`
   - Generates embedding for the query text
   - For each skill, loads/generates embedding for `buildEmbeddingText(skill)` — name + description + optional `metadata.triggers`
   - Computes cosine similarity between query and skill embeddings
   - Filters by threshold (default `SIMILARITY_THRESHOLD = 0.35`)
   - Drops matches more than `MARGIN` (default `0.10`) below the top score
   - Returns top-K matches (default `TOP_K = 5`), sorted by score, with the raw score attached

4. **Cache Management** (`getEmbedding`)
   - Computes SHA256 of input text
   - Checks disk cache in `~/.cache/opencode-agent-skills/embeddings/v2/`
   - Returns cached embedding if found
   - Generates new embedding, saves to cache, returns it

5. **Legacy Cache Prune** (`pruneLegacyEmbeddingCache`)
   - Called once at plugin startup
   - Removes `.bin` files directly in `~/.cache/opencode-agent-skills/embeddings/` (NOT inside `v2/`) — these are orphans from the pre-versioned cache layout
   - Idempotent; safe to call repeatedly

## Data Model

| Entity | Purpose | Source |
|--------|---------|--------|
| `Float32Array` | Embedding vector (384 dimensions) | `src/embeddings.ts` |
| `SkillSummary` | Input for matching (name + description + optional triggers + optional metadata) | `src/skills.ts` |

## External Contracts

### Inputs

| Source | Data | Trigger |
|--------|------|---------|
| Plugin Core | `SkillSummary[]` | Plugin startup (precomputation) + per-message chat (matching, after stripping) |
| External caller | Query text + `SkillSummary[]` | Direct call to `matchSkills` (tests) |
| Hugging Face | Model weights | First embedding request |

### Outputs

| Destination | Data | Trigger |
|-------------|------|---------|
| Caller of `matchSkills` | `Array<{ skill: SkillSummary; score: number }>` | After similarity computation |
| Disk cache | Binary embedding files under `embeddings/v2/` | After new embedding generation |

## Invariants

- **INV-001:** All embeddings are 384-dimensional Float32Arrays.
- **INV-002:** All embeddings are L2-normalized (magnitude ≈ 1.0).
- **INV-003:** Embedding cache keys are SHA256 hashes of the input text.
- **INV-004:** Cosine similarity ranges from -1.0 to 1.0; only values ≥ 0.35 are returned.
- **INV-005:** At most 5 skills are returned per match call. All returned scores are within `MARGIN = 0.10` of the top score.
- **INV-006:** `TIER_CUTOFF` (default `0.05`) is the threshold for the "high" relevance tier in `formatRelevantSkillsInjection`. It MUST be tighter than `MARGIN`, otherwise the "possible" tier branch is dead code.
- **INV-007:** Cache files are namespaced by `SCHEMA_VERSION` (`"v2"`). Older un-versioned `.bin` files are orphaned and pruned at startup.

## Dependencies

### This Subsystem Depends On

- `@huggingface/transformers` — for model loading and inference
- `node:crypto` — for SHA256 hashing
- `node:fs/promises` — for cache I/O and prune
- `src/skills.ts` — for `SkillSummary` type
- `src/logger.ts` — for prune + cache observability

### Other Subsystems Depending On This

- `src/plugin.ts` — calls `precomputeSkillEmbeddings` at startup, `pruneLegacyEmbeddingCache` at startup, and `matchSkills` per message. Imports `TIER_CUTOFF` for the `<relevant-skills>` relevance-tier rendering.

## Constraints

- **Performance:** First embedding generation takes 1-2s (model load). Subsequent cached embeddings are near-instant. Per-message matching cost is dominated by the stripText + 5-cosine passes; cache hits keep it well under 100ms.
- **Memory:** Model uses ~100MB RAM when loaded.
- **Disk:** Cache is bounded by the number of distinct `(name, description, triggers)` tuples — bounded by the number of skills. Legacy pre-versioned cache files are pruned at startup so they don't accumulate.
- **Offline:** Requires internet on first run to download model weights. Subsequent runs can be offline if cache is warm.
- **Network:** Supports `HF_ENDPOINT` environment variable for users in restricted networks.
