import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  applyHfEndpoint,
  buildEmbeddingText,
  cosineSimilarity,
  getEmbedding,
  matchSkills,
  pruneLegacyEmbeddingCache,
} from "./embeddings";
import { env } from "@huggingface/transformers";
import type { SkillSummary } from "./skills";

describe("embeddings", () => {
  describe("getEmbedding", () => {
    test("generates 384-dimensional embedding", async () => {
      const embedding = await getEmbedding("A test description");
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    test("generates normalized embeddings", async () => {
      const embedding = await getEmbedding("normalized vector");
      let magnitude = 0;
      for (let i = 0; i < embedding.length; i++) {
        const val = embedding[i];
        if (val !== undefined) {
          magnitude += val * val;
        }
      }
      expect(Math.sqrt(magnitude)).toBeCloseTo(1.0, 5);
    });

    test("caches results", async () => {
      const text = "Test caching behavior";
      const embedding1 = await getEmbedding(text);
      const embedding2 = await getEmbedding(text);

      // Should be identical (from cache)
      expect(embedding2.length).toBe(embedding1.length);
      for (let i = 0; i < embedding1.length; i++) {
        expect(embedding2[i]).toBe(embedding1[i]);
      }
    });

    test("generates different embeddings for different inputs", async () => {
      const embedding1 = await getEmbedding("First description");
      const embedding2 = await getEmbedding("Different description");

      let areSame = true;
      for (let i = 0; i < embedding1.length; i++) {
        if (embedding1[i] !== embedding2[i]) {
          areSame = false;
          break;
        }
      }
      expect(areSame).toBe(false);
    });
  });

  describe("cosineSimilarity", () => {
    test("returns 1.0 for identical vectors", () => {
      const vec = new Float32Array([1, 2, 3, 4, 5]);
      expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0, 5);
    });

    test("returns 0.0 for orthogonal vectors", () => {
      const vec1 = new Float32Array([1, 0, 0]);
      const vec2 = new Float32Array([0, 1, 0]);
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(0.0, 5);
    });

    test("returns -1.0 for opposite vectors", () => {
      const vec1 = new Float32Array([1, 0, 0]);
      const vec2 = new Float32Array([-1, 0, 0]);
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(-1.0, 5);
    });

    test("calculates correct similarity for arbitrary vectors", () => {
      const vec1 = new Float32Array([1, 2, 3]);
      const vec2 = new Float32Array([4, 5, 6]);
      // (1*4 + 2*5 + 3*6) / (sqrt(14) * sqrt(77)) ≈ 0.9746
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(0.9746, 3);
    });

    test("throws error for mismatched vector lengths", () => {
      const vec1 = new Float32Array([1, 2, 3]);
      const vec2 = new Float32Array([1, 2]);
      expect(() => cosineSimilarity(vec1, vec2)).toThrow("same length");
    });

    test("returns 0 for zero vectors", () => {
      const vec1 = new Float32Array([0, 0, 0]);
      const vec2 = new Float32Array([1, 2, 3]);
      expect(cosineSimilarity(vec1, vec2)).toBe(0);
    });

    test("works with real embeddings", async () => {
      const embedding1 = await getEmbedding("The cat sat on the mat");
      const embedding2 = await getEmbedding("A cat was sitting on a mat");
      const similarity = cosineSimilarity(embedding1, embedding2);

      // Similar sentences should have high similarity
      expect(similarity).toBeGreaterThan(0.7);
      expect(similarity).toBeLessThanOrEqual(1.0);
    });
  });

  describe("matchSkills", () => {
    const sampleSkills: SkillSummary[] = [
      {
        name: "git-helper",
        description: "Provides git workflow assistance, branch management, and commit message optimization",
      },
      {
        name: "pdf",
        description: "Comprehensive PDF manipulation toolkit for extracting text and tables",
      },
      {
        name: "docx",
        description: "Document creation, editing, and analysis with support for tracked changes",
      },
      {
        name: "brainstorming",
        description: "Refines rough ideas into fully-formed designs through collaborative questioning",
      },
      {
        name: "frontend-design",
        description: "Create distinctive, production-grade frontend interfaces with high design quality",
      },
    ];


    describe("task request matching", () => {
      test("matches git-related tasks", async () => {
        const matches = await matchSkills("Help me create a new branch and commit my changes", sampleSkills);

        expect(matches.length).toBeGreaterThan(0);
        expect(matches.some(m => m.skill.name === "git-helper")).toBe(true);
        expect(matches.every(m => m.skill.description)).toBe(true);
      });

      test("matches PDF tasks", async () => {
        const matches = await matchSkills("Extract tables from this PDF document", sampleSkills);

        expect(matches.length).toBeGreaterThan(0);
        expect(matches.some(m => m.skill.name === "pdf")).toBe(true);
        expect(matches.every(m => m.skill.description)).toBe(true);
      });

      test("matches document editing tasks", async () => {
        const matches = await matchSkills("Edit this Word document and track changes", sampleSkills);

        expect(matches.length).toBeGreaterThan(0);
        expect(matches.some(m => m.skill.name === "docx")).toBe(true);
        expect(matches.every(m => m.skill.description)).toBe(true);
      });

      test("matches brainstorming tasks", async () => {
        const matches = await matchSkills("Help me refine this rough idea into a design", sampleSkills);

        expect(matches.length).toBeGreaterThan(0);
        expect(matches.some(m => m.skill.name === "brainstorming")).toBe(true);
        expect(matches.every(m => m.skill.description)).toBe(true);
      });

      test("matches frontend design tasks", async () => {
        const matches = await matchSkills("Create a production-grade user interface", sampleSkills);

        expect(matches.length).toBeGreaterThan(0);
        expect(matches.some(m => m.skill.name === "frontend-design")).toBe(true);
        expect(matches.every(m => m.skill.description)).toBe(true);
      });
    });

    describe("multiple skill matching", () => {
      test("can match multiple skills for complex tasks", async () => {
        const matches = await matchSkills("Design a frontend interface and help me brainstorm ideas", sampleSkills);

        expect(matches.length).toBeGreaterThan(0);
        expect(matches.some(m => m.skill.name === "frontend-design" || m.skill.name === "brainstorming")).toBe(true);
        expect(matches.every(m => m.skill.description)).toBe(true);
      });

      test("returns at most 5 skills (respects topK limit)", async () => {
        const manySkills: SkillSummary[] = Array.from({ length: 20 }, (_, i) => ({
          name: `skill-${i}`,
          description: "Test skill for matching testing purposes",
        }));

        const matches = await matchSkills("testing", manySkills);
        expect(matches.length).toBeLessThanOrEqual(5);
        expect(matches.every(m => m.skill.name && m.skill.description)).toBe(true);
      });

      test("returns at most topK=2 when requested via options object", async () => {
        const manySkills: SkillSummary[] = Array.from({ length: 20 }, (_, i) => ({
          name: `skill-${i}`,
          description: "Test skill for matching testing purposes",
        }));

        const matches = await matchSkills("testing", manySkills, { topK: 2 });
        expect(matches.length).toBeLessThanOrEqual(2);
        expect(matches.every(m => m.skill.name && m.skill.description)).toBe(true);
      });
    });

    describe("edge cases", () => {
      test("returns empty array when skill list is empty", async () => {
        const matches = await matchSkills("Help me with git", []);
        expect(matches).toEqual([]);
      });

      test("returns empty array for unrelated topics", async () => {
        const matches = await matchSkills("xyzabc123qwerty456", sampleSkills);
        expect(matches).toEqual([]);
      });

      test("handles very long messages", async () => {
        const longMessage = "Create a frontend interface ".repeat(100);
        const matches = await matchSkills(longMessage, sampleSkills);

        expect(matches.length).toBeGreaterThan(0);
      });

      test("handles messages with special characters", async () => {
        const matches = await matchSkills("Create git branch for feature work! @#$%^&*()", sampleSkills);

        expect(matches.length).toBeGreaterThan(0);
        expect(matches.some(m => m.skill.name === "git-helper")).toBe(true);
        expect(matches.every(m => m.skill.description)).toBe(true);
      });

      test("returns { skill, score } shape with required fields", async () => {
        const matches = await matchSkills("Help with git", sampleSkills);

        expect(Array.isArray(matches)).toBe(true);
        if (matches.length > 0) {
          matches.forEach(match => {
            expect(match).toHaveProperty("skill");
            expect(match).toHaveProperty("score");
            expect(typeof match.score).toBe("number");
            expect(match.skill).toHaveProperty("name");
            expect(match.skill).toHaveProperty("description");
            expect(typeof match.skill.name).toBe("string");
            expect(typeof match.skill.description).toBe("string");
          });
        }
      });

      test("respects a custom threshold via options object", async () => {
        // Very high threshold should suppress most matches
        const high = await matchSkills("Help with git", sampleSkills, { threshold: 0.99 });
        const low = await matchSkills("Help with git", sampleSkills, { threshold: 0.0 });
        expect(high.length).toBeLessThanOrEqual(low.length);
      });
    });


    describe("consistency with original behavior", () => {
      test("returns empty array when no match", async () => {
        const matches = await matchSkills("completely unrelated query xyz123", sampleSkills);
        expect(matches).toEqual([]);
      });

      test("returns skill names as strings", async () => {
        const matches = await matchSkills("Help with git", sampleSkills);

        if (matches.length > 0) {
          matches.forEach(match => {
            expect(typeof match.skill.name).toBe("string");
          });
        }
      });
    });

    describe("margin filter", () => {
      test("every returned match has score within `margin` of the top", async () => {
        // threshold=0 lets every non-negative cosine pass, so the only
        // surviving filter is the margin cutoff against the top score.
        const margin = 0.05;
        const matches = await matchSkills(
          "Help me create a git commit",
          sampleSkills,
          { threshold: 0, margin, topK: 10 },
        );

        if (matches.length >= 1) {
          const topScore = matches[0]!.score;
          for (const m of matches) {
            // Tiny floating-point epsilon; the contract is ">= topScore - margin"
            expect(m.score).toBeGreaterThanOrEqual(topScore - margin - 1e-9);
          }
        }
      });

      test("a tight margin yields a smaller result set than a generous margin", async () => {
        const tight = await matchSkills(
          "Help me commit changes to a git branch",
          sampleSkills,
          { threshold: 0, margin: 0.001, topK: 10 },
        );
        const generous = await matchSkills(
          "Help me commit changes to a git branch",
          sampleSkills,
          { threshold: 0, margin: 0.9, topK: 10 },
        );

        // The generous case may include everything above the threshold;
        // the tight case keeps only matches within 0.001 of the top.
        // Same query, same skills — the contract guarantees tight <= generous.
        expect(tight.length).toBeLessThanOrEqual(generous.length);
      });

      test("margin cuts off BEFORE the topK cap (matches in returned set are within margin of top)", async () => {
        const matches = await matchSkills(
          "commit git changes",
          sampleSkills,
          { threshold: 0, margin: 0.10, topK: 5 },
        );

        expect(matches.length).toBeLessThanOrEqual(5);
        if (matches.length >= 2) {
          const topScore = matches[0]!.score;
          for (const m of matches) {
            expect(m.score).toBeGreaterThanOrEqual(topScore - 0.10 - 1e-9);
          }
        }
      });
    });
  });

  describe("buildEmbeddingText", () => {
    test("uses name and description only when no triggers present", () => {
      const text = buildEmbeddingText({
        name: "git-helper",
        description: "Git workflow",
      });
      expect(text).toBe("git-helper: Git workflow");
    });

    test("treats triggers as the empty array when property is missing", () => {
      const text = buildEmbeddingText({
        name: "pdf",
        description: "PDF tooling",
      });
      // No triggers key — should be treated as undefined/[] → no Triggers: suffix
      expect(text).not.toContain("Triggers:");
    });

    test("treats an explicit triggers=[] as no triggers", () => {
      const text = buildEmbeddingText({
        name: "pdf",
        description: "PDF tooling",
        triggers: [],
      });
      expect(text).not.toContain("Triggers:");
    });

    test("renders triggers joined by ', ' when present and non-empty", () => {
      const text = buildEmbeddingText({
        name: "skill-creator",
        description: "Helps creating skills",
        triggers: ["create", "skill", "design"],
      });
      expect(text).toBe("skill-creator: Helps creating skills. Triggers: create, skill, design");
    });

    test("single trigger renders alone in the Triggers suffix", () => {
      const text = buildEmbeddingText({
        name: "docx",
        description: "Word documents",
        triggers: ["word"],
      });
      expect(text).toBe("docx: Word documents. Triggers: word");
    });
  });

  describe("applyHfEndpoint", () => {
    let originalHfEndpoint: string | undefined;
    let originalRemoteHost: string;

    beforeEach(() => {
      originalHfEndpoint = process.env.HF_ENDPOINT;
      originalRemoteHost = env.remoteHost;
    });

    afterEach(() => {
      if (originalHfEndpoint === undefined) {
        delete process.env.HF_ENDPOINT;
      } else {
        process.env.HF_ENDPOINT = originalHfEndpoint;
      }
      env.remoteHost = originalRemoteHost;
    });

    test("sets env.remoteHost when HF_ENDPOINT is defined", () => {
      process.env.HF_ENDPOINT = "https://hf-mirror.com";
      applyHfEndpoint();
      expect(env.remoteHost).toBe("https://hf-mirror.com");
    });

    test("does not change env.remoteHost when HF_ENDPOINT is undefined", () => {
      delete process.env.HF_ENDPOINT;
      applyHfEndpoint();
      expect(env.remoteHost).toBe(originalRemoteHost);
    });

    test("trims HF_ENDPOINT before setting env.remoteHost", () => {
      process.env.HF_ENDPOINT = "  https://hf-mirror.com  ";
      applyHfEndpoint();
      expect(env.remoteHost).toBe("https://hf-mirror.com");
    });

    test("does not change env.remoteHost when HF_ENDPOINT is empty string", () => {
      process.env.HF_ENDPOINT = "";
      applyHfEndpoint();
      expect(env.remoteHost).toBe(originalRemoteHost);
    });

    test("does not change env.remoteHost when HF_ENDPOINT is only whitespace", () => {
      process.env.HF_ENDPOINT = "   ";
      applyHfEndpoint();
      expect(env.remoteHost).toBe(originalRemoteHost);
    });
  });
});

describe("pruneLegacyEmbeddingCache", () => {
  let tempHome: string;
  let originalXdgCache: string | undefined;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  // Override cache base dir by setting XDG_CACHE_HOME to a fresh temp dir.
  // The function uses `getCacheBaseDir()` which respects XDG_CACHE_HOME.
  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(tmpdir(), "prune-cache-test-"));
    originalXdgCache = process.env.XDG_CACHE_HOME;
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.XDG_CACHE_HOME = tempHome;
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
  });

  afterEach(async () => {
    if (originalXdgCache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = originalXdgCache;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    if (existsSync(tempHome)) {
      await fs.rm(tempHome, { recursive: true, force: true });
    }
  });

  test("returns 0 and does not throw on a fresh install (no embeddings dir)", async () => {
    // First-run case: the cache directory doesn't exist yet. ENOENT must be
    // handled silently without surfacing as an error.
    expect(existsSync(path.join(tempHome, "opencode-agent-skills", "embeddings"))).toBe(false);
    const removed = await pruneLegacyEmbeddingCache();
    expect(removed).toBe(0);
  });

  test("preserves files in the current SCHEMA_VERSION directory (v2/)", async () => {
    const v2Dir = path.join(tempHome, "opencode-agent-skills", "embeddings", "v2");
    await fs.mkdir(v2Dir, { recursive: true });
    const liveFile = path.join(v2Dir, "live-hash.bin");
    await fs.writeFile(liveFile, "live-data");

    const removed = await pruneLegacyEmbeddingCache();
    expect(removed).toBe(0);
    expect(existsSync(liveFile)).toBe(true);
  });

  test("removes legacy `.bin` files at the embeddings root", async () => {
    const rootDir = path.join(tempHome, "opencode-agent-skills", "embeddings");
    await fs.mkdir(rootDir, { recursive: true });
    const legacyFile = path.join(rootDir, "legacy-hash.bin");
    await fs.writeFile(legacyFile, "legacy-data");

    const removed = await pruneLegacyEmbeddingCache();
    expect(removed).toBe(1);
    expect(existsSync(legacyFile)).toBe(false);
  });

  test("leaves non-`.bin` files at the embeddings root untouched", async () => {
    const rootDir = path.join(tempHome, "opencode-agent-skills", "embeddings");
    await fs.mkdir(rootDir, { recursive: true });
    const readme = path.join(rootDir, "README.md");
    await fs.writeFile(readme, "keep me");

    const removed = await pruneLegacyEmbeddingCache();
    expect(removed).toBe(0);
    expect(existsSync(readme)).toBe(true);
  });

  test("removes legacy `.bin` files inside legacy versioned subtrees (v1/, etc.)", async () => {
    // Simulate a future SCHEMA_VERSION bump: v1/ is no longer live.
    const v1Dir = path.join(tempHome, "opencode-agent-skills", "embeddings", "v1");
    await fs.mkdir(v1Dir, { recursive: true });
    const legacyFile = path.join(v1Dir, "stale-hash.bin");
    await fs.writeFile(legacyFile, "stale-data");

    const removed = await pruneLegacyEmbeddingCache();
    expect(removed).toBe(1);
    expect(existsSync(legacyFile)).toBe(false);
  });

  test("is idempotent — second call removes nothing", async () => {
    const rootDir = path.join(tempHome, "opencode-agent-skills", "embeddings");
    await fs.mkdir(rootDir, { recursive: true });
    const legacyFile = path.join(rootDir, "legacy.bin");
    await fs.writeFile(legacyFile, "x");

    expect(await pruneLegacyEmbeddingCache()).toBe(1);
    expect(await pruneLegacyEmbeddingCache()).toBe(0);
  });
});
