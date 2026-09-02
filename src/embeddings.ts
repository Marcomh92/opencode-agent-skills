import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import type { SkillSummary } from "./skills";
import { log } from "./logger";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const QUANTIZATION = "q8";
const SIMILARITY_THRESHOLD = 0.35;
const TOP_K = 5;
const MARGIN = 0.10;

/**
 * Tier cutoff for rendering "high" vs "possible" relevance in the
 * `<relevant-skills>` injection. Must be TIGHTER than `MARGIN` — otherwise
 * every match in the returned set is within `TIER_CUTOFF` of the top, and the
 * "possible" branch is dead code.
 *
 * Exported so callers (e.g. `src/plugin.ts`) can't drift from this constant.
 */
export const TIER_CUTOFF = 0.05;

/**
 * Bump when the embedded-text shape changes (e.g. adding triggers). Cache
 * files are namespaced by this version so old `.bin` files become orphans
 * (harmlessly ignored) rather than colliding with the new shape.
 */
const SCHEMA_VERSION = "v2";

let model: FeatureExtractionPipeline | null = null;
let modelPromise: Promise<void> | null = null;

/**
 * Apply HF_ENDPOINT environment variable to the transformers remote host config.
 * This allows users in restricted networks to use a mirror instead of huggingface.co.
 * @see https://github.com/joshuadavidthomas/opencode-agent-skills/issues/36
 */
export function applyHfEndpoint(): void {
  const hfEndpoint = process.env.HF_ENDPOINT?.trim();
  if (hfEndpoint) {
    env.remoteHost = hfEndpoint;
  }
}

async function ensureModel(): Promise<void> {
  if (model) return;
  if (!modelPromise) {
    modelPromise = (async () => {
      applyHfEndpoint();
      model = await pipeline("feature-extraction", MODEL_NAME, { dtype: QUANTIZATION });
    })();
  }
  await modelPromise;
}

function getCacheBaseDir(): string {
  const xdgCacheHome = process.env.XDG_CACHE_HOME;
  return xdgCacheHome
    ? path.join(xdgCacheHome, "opencode-agent-skills")
    : path.join(homedir(), ".cache", "opencode-agent-skills");
}

function getCachePath(contentHash: string): string {
  // ponytail: namespace by schema version so old un-versioned `.bin` files in
  // `<baseDir>/embeddings/` are orphaned (never read) when the embedded-text
  // shape changes. `pruneLegacyEmbeddingCache` removes those orphans at
  // startup so they don't accumulate.
  return path.join(getCacheBaseDir(), "embeddings", SCHEMA_VERSION, `${contentHash}.bin`);
}

/**
 * Remove legacy (non-current-schema-version) `.bin` files from the embedding
 * cache directory. Called once at plugin startup so cache files orphaned by
 * a `SCHEMA_VERSION` bump don't accumulate indefinitely.
 *
 * Handles two orphan layouts:
 * - Root `.bin` files (`<baseDir>/embeddings/*.bin`) — orphans from before
 *   the SCHEMA_VERSION layout was introduced
 * - Legacy versioned subtrees (`<baseDir>/embeddings/v(N)/**` where N !=
 *   SCHEMA_VERSION) — orphans left behind when the schema bumps and the old
 *   version directory stops being live
 *
 * Safe to call repeatedly (idempotent) and on a fresh install (silently
 * skips when the directory doesn't exist yet). The current schema-version
 * subdirectory (`v2/`) and any non-`.bin` files are left untouched.
 *
 * Returns the number of files removed (mainly for logging).
 */
export async function pruneLegacyEmbeddingCache(): Promise<number> {
  const embeddingsDir = path.join(getCacheBaseDir(), "embeddings");
  let removed = 0;
  try {
    const entries = await fs.readdir(embeddingsDir, { withFileTypes: true });
    for (const entry of entries) {
      // Live data — never touch it.
      if (entry.isDirectory() && entry.name === SCHEMA_VERSION) continue;
      if (entry.isFile() && entry.name.endsWith(".bin")) {
        // Legacy `.bin` at the embeddings root.
        try {
          await fs.unlink(path.join(embeddingsDir, entry.name));
          removed++;
        } catch (err) {
          await log(`[EMBEDDINGS] Failed to remove legacy cache file ${entry.name}: ${(err as Error).message}`);
        }
      } else if (entry.isDirectory()) {
        // Legacy versioned subtree — prune its `.bin` files one level deep.
        const subDir = path.join(embeddingsDir, entry.name);
        try {
          const subEntries = await fs.readdir(subDir, { withFileTypes: true });
          for (const subEntry of subEntries) {
            if (subEntry.isFile() && subEntry.name.endsWith(".bin")) {
              try {
                await fs.unlink(path.join(subDir, subEntry.name));
                removed++;
              } catch (err) {
                await log(`[EMBEDDINGS] Failed to remove legacy cache file ${entry.name}/${subEntry.name}: ${(err as Error).message}`);
              }
            }
          }
        } catch (err) {
          await log(`[EMBEDDINGS] Failed to scan legacy cache subdir ${entry.name}: ${(err as Error).message}`);
        }
      }
    }
    if (removed > 0) {
      await log(`[EMBEDDINGS] Pruned ${removed} legacy embedding cache file(s) under ${embeddingsDir}`);
    }
  } catch (err) {
    // Directory doesn't exist yet — first run, nothing to prune.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      await log(`[EMBEDDINGS] Legacy cache prune skipped: ${(err as Error).message}`);
    }
  }
  return removed;
}

/**
 * Build the text that gets embedded for a skill. Combines name + description
 * + optional triggers so generic words in the description (e.g. "skill" in
 * `skill-creator`) don't dominate the similarity signal.
 */
export function buildEmbeddingText(skill: SkillSummary): string {
  const triggers = skill.triggers ?? [];
  const triggerSuffix = triggers.length > 0
    ? `. Triggers: ${triggers.join(", ")}`
    : "";
  return `${skill.name}: ${skill.description}${triggerSuffix}`;
}

/**
 * Generate an embedding for the given text.
 * Results are cached to disk based on content hash.
 */
export async function getEmbedding(text: string): Promise<Float32Array> {
  await ensureModel();
  if (!model) throw new Error("Model failed to load");

  const hash = crypto.createHash("sha256").update(text).digest("hex");
  const cachePath = getCachePath(hash);

  try {
    const buffer = await fs.readFile(cachePath);
    return new Float32Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );
  } catch {
    // Generate new embedding
  }

  const result = await model(text, { pooling: "mean", normalize: true });

  const embedding = result.data instanceof Float32Array
    ? result.data
    : new Float32Array(Array.from(result.data as ArrayLike<number>));

  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength));

  return embedding;
}

/**
 * Compute cosine similarity between two embedding vectors.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vectors must have the same length (got ${a.length} and ${b.length})`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const valA = a[i]!;
    const valB = b[i]!;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Precompute embeddings for all skills at plugin startup.
 * Embeddings are cached to disk, so this warms the cache. Uses
 * `buildEmbeddingText` so the precomputed cache matches what per-message
 * matching uses.
 */
export async function precomputeSkillEmbeddings(skills: SkillSummary[]): Promise<void> {
  await Promise.all(
    skills.map(skill =>
      getEmbedding(buildEmbeddingText(skill)).catch(() => { })
    )
  );
}

/**
 * Match user message against available skills using semantic similarity.
 * Returns top matching skills above the threshold, sorted by score, with
 * the raw score attached so callers can render relevance tiers.
 *
 * The `margin` filter drops any match whose score is more than `margin`
 * below the top score in the result set — a coarse way to suppress
 * borderline matches that the threshold alone would admit.
 *
 * ponytail: `topK` is applied AFTER margin filtering, so a wide-but-shallow
 * match set shrinks rather than getting padded with low-confidence hits.
 */
export async function matchSkills(
  userMessage: string,
  availableSkills: SkillSummary[],
  options?: { topK?: number; threshold?: number; margin?: number }
): Promise<Array<{ skill: SkillSummary; score: number }>> {
  const topK = options?.topK ?? TOP_K;
  const threshold = options?.threshold ?? SIMILARITY_THRESHOLD;
  const margin = options?.margin ?? MARGIN;

  if (availableSkills.length === 0) {
    return [];
  }

  const queryEmbedding = await getEmbedding(userMessage);

  const scored = await Promise.all(
    availableSkills.map(async (skill) => ({
      skill,
      score: cosineSimilarity(
        queryEmbedding,
        await getEmbedding(buildEmbeddingText(skill)),
      ),
    })),
  );

  const passed = scored.filter((s) => s.score >= threshold);

  if (passed.length === 0) return [];

  passed.sort((a, b) => b.score - a.score);
  const topScore = passed[0]?.score ?? 0;
  const marginCutoff = topScore - margin;

  return passed.filter((s) => s.score >= marginCutoff).slice(0, topK);
}
