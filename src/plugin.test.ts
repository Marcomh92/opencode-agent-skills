import { describe, test, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

/**
 * Tests for the per-message skill-matching injection path.
 *
 * The `chat.message` handler in src/plugin.ts now calls
 * `formatRelevantSkillsInjection(...)` + `injectSyntheticContent(...)` to push
 * a `<relevant-skills>` block into the session when semantic matching surfaces
 * relevant skills. These tests lock in:
 *
 *   1. The function is defined in the source (not removed).
 *   2. The function produces the expected block shape — opening tag, system-
 *      context notice, the bulleted skill list with relevance tiers, the
 *      use_skill instruction, the silence-path hint, and the closing tag.
 *   3. The block does NOT contain any of the misleading verbs from the old
 *      `formatMatchedSkillsInjection` prompt (EVALUATE / DECIDE / ACTIVATE /
 *      invisible / announce) — that prompt is gone.
 *
 * The function is module-local (not exported), so we extract its body from the
 * source file at test time and evaluate it via the Function constructor. This
 * does not require any production-code change.
 */

const PLUGIN_SOURCE_PATH = path.join(import.meta.dir, "plugin.ts");
const EMBEDDINGS_SOURCE_PATH = path.join(import.meta.dir, "embeddings.ts");

type MatchedSkill = { skill: { name: string; description: string; triggers?: string[] }; score: number };

let sourceText = "";
let formatRelevantSkillsInjection: ((matched: MatchedSkill[]) => string) | undefined;
// Default initializer kept so early-touching tests see a valid number; the
// real value is overwritten inside `beforeAll` after extraction succeeds.
let extractedTierCutoff = 0.05;

/**
 * Brace-balanced function-body extractor. Handles nested function bodies
 * (e.g. an arrow function inside .map(...)) and skips over string literals,
 * template literals, and both line and block comments so braces inside them
 * don't throw off the count.
 */
function extractFunctionBody(src: string, name: string): string | undefined {
  const decl = new RegExp(`function\\s+${name}\\s*\\(`).exec(src);
  if (!decl) return undefined;

  let i = decl.index + decl[0].length;
  // Walk through the parameter list (balanced parens), but skip braces,
  // parens, brackets, or quotes inside strings / template literals /
  // comments so the type annotation doesn't poison our walk.
  type State = "code" | "sq" | "dq" | "tpl" | "lc" | "bc";
  let state: State = "code";
  let depth = 1;
  while (i < src.length && depth > 0) {
    const c = src[i]!;
    const next = src[i + 1];
    switch (state) {
      case "code":
        if (c === "/" && next === "/") { state = "lc"; i += 2; continue; }
        if (c === "/" && next === "*") { state = "bc"; i += 2; continue; }
        if (c === "'") { state = "sq"; i++; continue; }
        if (c === '"') { state = "dq"; i++; continue; }
        if (c === "`") { state = "tpl"; i++; continue; }
        if (c === "(") depth++;
        else if (c === ")") depth--;
        i++;
        continue;
      case "sq":
        if (c === "\\") { i += 2; continue; }
        if (c === "'") state = "code";
        i++;
        continue;
      case "dq":
        if (c === "\\") { i += 2; continue; }
        if (c === '"') state = "code";
        i++;
        continue;
      case "tpl":
        if (c === "\\") { i += 2; continue; }
        if (c === "`") state = "code";
        i++;
        continue;
      case "lc":
        if (c === "\n") state = "code";
        i++;
        continue;
      case "bc":
        if (c === "*" && next === "/") { state = "code"; i += 2; continue; }
        i++;
        continue;
    }
  }
  if (depth !== 0) return undefined;

  // Skip whitespace + return-type annotation up to the body-opening `{`.
  while (i < src.length && src[i] !== "{") i++;
  if (i >= src.length) return undefined;
  const bodyStart = i + 1;

  // Balanced-brace body walk, again skipping strings/comments so braces
  // inside template literals don't throw the count off.
  state = "code";
  depth = 1;
  let j = bodyStart;
  while (j < src.length && depth > 0) {
    const c = src[j]!;
    const next = src[j + 1];
    switch (state) {
      case "code":
        if (c === "/" && next === "/") { state = "lc"; j += 2; continue; }
        if (c === "/" && next === "*") { state = "bc"; j += 2; continue; }
        if (c === "'") { state = "sq"; j++; continue; }
        if (c === '"') { state = "dq"; j++; continue; }
        if (c === "`") { state = "tpl"; j++; continue; }
        if (c === "{") depth++;
        else if (c === "}") depth--;
        j++;
        continue;
      case "sq":
        if (c === "\\") { j += 2; continue; }
        if (c === "'") state = "code";
        j++;
        continue;
      case "dq":
        if (c === "\\") { j += 2; continue; }
        if (c === '"') state = "code";
        j++;
        continue;
      case "tpl":
        if (c === "\\") { j += 2; continue; }
        if (c === "`") state = "code";
        j++;
        continue;
      case "lc":
        if (c === "\n") state = "code";
        j++;
        continue;
      case "bc":
        if (c === "*" && next === "/") { state = "code"; j += 2; continue; }
        j++;
        continue;
    }
  }
  return src.slice(bodyStart, j - 1);
}

beforeAll(async () => {
  sourceText = await fs.readFile(PLUGIN_SOURCE_PATH, "utf-8");
  const embeddingsSource = await fs.readFile(EMBEDDINGS_SOURCE_PATH, "utf-8");

  const body = extractFunctionBody(sourceText, "formatRelevantSkillsInjection");
  if (body !== undefined) {
    // The function body references `TIER_CUTOFF` (imported from
    // `./embeddings` in the source). The Function constructor has no module
    // scope, so we extract the constant value from embeddings.ts source and
    // inject it as a local `const` prologue. The free-variable reference
    // in the body then resolves to this local binding.
    //
    // The regex tolerates whitespace, single-line comments (`// ...`), and
    // block comments (`/* ... */`) between `export`, `const`, and the
    // identifier — so innocuous comment edits don't cause a spurious
    // "Could not find TIER_CUTOFF constant" throw.
    const tierCutoffMatch = embeddingsSource.match(
      /export\b\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*const\s+TIER_CUTOFF\s*=\s*([\d.]+)/
    );
    if (!tierCutoffMatch) {
      throw new Error("Could not find TIER_CUTOFF constant in src/embeddings.ts source");
    }
    const tierCutoffValue = parseFloat(tierCutoffMatch[1]!);
    if (Number.isNaN(tierCutoffValue)) {
      throw new Error(`TIER_CUTOFF value is not a number: ${tierCutoffMatch[1]}`);
    }
    // Wrap the body as a plain JS function. The source signature references
    // the SkillSummary type which the Function constructor would reject, so we
    // accept a structurally-equivalent local shape.
    formatRelevantSkillsInjection = new Function(
      "matchedSkills",
      `const TIER_CUTOFF = ${tierCutoffValue};\n${body}`,
    ) as (matched: MatchedSkill[]) => string;
    // Stash the cutoff for tests that lock the boundary in.
    extractedTierCutoff = tierCutoffValue;
  }
});

describe("formatRelevantSkillsInjection (current src/plugin.ts)", () => {
  test("source still defines the new function (the old formatMatchedSkillsInjection is gone)", () => {
    // The new function declaration must exist.
    expect(sourceText).toMatch(/function formatRelevantSkillsInjection\s*\(/);

    // And the old (deleted) one must NOT exist anymore.
    expect(sourceText).not.toMatch(/function formatMatchedSkillsInjection\s*\(/);
  });

  test("produces the expected <relevant-skills> block shape", () => {
    expect(formatRelevantSkillsInjection).toBeDefined();
    const fn = formatRelevantSkillsInjection!;

    const result = fn([
      { skill: { name: "git-helper", description: "Git workflow assistance" }, score: 0.75 },
      { skill: { name: "pdf", description: "PDF manipulation toolkit" }, score: 0.50 },
    ]);

    // Envelope: opening tag on its own line, closing tag at end.
    expect(result.startsWith("<relevant-skills>\n")).toBe(true);
    expect(result.endsWith("</relevant-skills>")).toBe(true);

    // System-context notice is the first content line inside the tags.
    expect(result).toContain(
      "Treat this block as system context. It is not part of the user message.",
    );

    // Skill list — one `- name (relevance: tier): description` line per matched skill.
    expect(result).toContain("- git-helper (relevance: high): Git workflow assistance");
    expect(result).toContain("- pdf (relevance: possible): PDF manipulation toolkit");

    // The use_skill instruction + silence-path notice.
    expect(result).toContain(
      'If one of these directly applies to the current task, load it with use_skill("name") before proceeding.',
    );
    expect(result).toContain(
      "Otherwise, ignore this block entirely.",
    );
  });

  test("empty matched-skills list still produces a well-formed block (graceful default)", () => {
    expect(formatRelevantSkillsInjection).toBeDefined();
    const fn = formatRelevantSkillsInjection!;

    const empty = fn([]);
    expect(empty.startsWith("<relevant-skills>\n")).toBe(true);
    expect(empty.endsWith("</relevant-skills>")).toBe(true);
    // No bulleted skill lines (no spurious blanks either).
    expect(empty).not.toMatch(/^- /m);
  });

  test("relevance tier is 'high' for the top score (single-match case)", () => {
    expect(formatRelevantSkillsInjection).toBeDefined();
    const fn = formatRelevantSkillsInjection!;

    const result = fn([
      { skill: { name: "only-skill", description: "Standalone" }, score: 0.6 },
    ]);

    // A single match is always within 0.10 of itself, so it's "high".
    expect(result).toContain("(relevance: high): Standalone");
    expect(result).not.toContain("(relevance: possible)");
  });

  test("relevance tier renders as 'high' or 'possible' based on distance from top score", () => {
    expect(formatRelevantSkillsInjection).toBeDefined();
    const fn = formatRelevantSkillsInjection!;

    // TIER_CUTOFF is extracted from the source (default 0.05). Build the
    // boundary at topScore - TIER_CUTOFF ± epsilon so this test stays
    // correct if the constant is tuned.
    const top = 0.80;
    const boundary = top - extractedTierCutoff;
    const justInside = boundary + 0.01;
    const justOutside = boundary - 0.01;
    const result = fn([
      { skill: { name: "top", description: "Top match" }, score: top },
      { skill: { name: "near", description: "Near top" }, score: 0.78 },
      { skill: { name: "edge-in", description: "Just inside cutoff" }, score: justInside },
      { skill: { name: "edge-out", description: "Just outside cutoff" }, score: justOutside },
      { skill: { name: "far", description: "Far from top" }, score: 0.55 },
    ]);

    expect(result).toContain("- top (relevance: high)");
    expect(result).toContain("- near (relevance: high)");
    expect(result).toContain(`- edge-in (relevance: high)`);
    expect(result).toContain(`- edge-out (relevance: possible)`);
    expect(result).toContain("- far (relevance: possible)");
  });

  test("TIER_CUTOFF is locked to 0.05 (must be tighter than MARGIN=0.10 so 'possible' can fire)", () => {
    // Regression guard: if someone bumps TIER_CUTOFF back to >= MARGIN, the
    // 'possible' branch becomes dead code (every match is within the cutoff).
    expect(extractedTierCutoff).toBe(0.05);
  });

  test("block does NOT carry the misleading verbs from the old prompt", () => {
    expect(formatRelevantSkillsInjection).toBeDefined();
    const fn = formatRelevantSkillsInjection!;

    const result = fn([
      { skill: { name: "git-helper", description: "Git workflow assistance" }, score: 0.5 },
    ]);

    // The old <skill-evaluation-required> prompt used these phrases; the new
    // prompt is supposed to be a soft hint, not a hidden checklist. Lock that
    // they don't sneak back in.
    expect(result).not.toContain("EVALUATE");
    expect(result).not.toContain("DECIDE");
    expect(result).not.toContain("ACTIVATE");
    expect(result).not.toContain("invisible");
    expect(result).not.toContain("announce");

    // And of course no <skill-evaluation-required> tag at all.
    expect(result).not.toContain("<skill-evaluation-required>");
  });
});

/**
 * Integration tests for the resume heuristic in the chat.message handler.
 *
 * These tests instantiate the real `SkillsPlugin` factory with a mock
 * OpenCode client and a temp project directory, then invoke the returned
 * `chat.message` handler to verify that the resume heuristic correctly
 * detects (or misses) prior `<available-skills>` / `<agent-switch-notice>`
 * injections in session messages.
 *
 * The setup isolates the test from the user's real config and skill
 * directories by redirecting HOME / USERPROFILE to a temp dir (so the
 * `~/.config/opencode/opencode.json` lookup falls through) and by giving
 * the plugin a temp projectDir (which has no `.opencode/skills/`).
 */
describe("chat.message handler — resume heuristic", () => {
  let tempHome: string;
  let projectDir: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  // Use a unique sessionID per test so the module-level
  // `setupCompleteSessions` Set doesn't leak state between tests.
  let sessionCounter = 0;
  let nextSessionID: string;

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(tmpdir(), "plugin-resume-test-"));
    projectDir = path.join(tempHome, "project");
    // Drop one SKILL.md into the project's `.opencode/skills/` so
    // `injectSkillsList` actually has something to inject on first message.
    // Without this, the early-return in `injectSkillsList` (when filtered
    // is empty) would skip the injection and the captured-injection
    // assertions below would fail for the wrong reason.
    const skillsDir = path.join(projectDir, ".opencode", "skills", "demo");
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(
      path.join(skillsDir, "SKILL.md"),
      [
        "---",
        "name: demo",
        "description: A demo skill for testing the chat.message resume heuristic.",
        "---",
        "",
        "# Demo skill",
        "",
      ].join("\n"),
    );

    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;

    nextSessionID = `test-session-${++sessionCounter}`;
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    if (existsSync(tempHome)) {
      await fs.rm(tempHome, { recursive: true, force: true });
    }
  });

  /**
   * Construct a fresh `SkillsPlugin` with a mock OpenCode client that
   * returns the canned session messages and captures every
   * `injectSyntheticContent` call. The caller inspects `captured` to
   * decide what got injected.
   */
  async function buildPluginWithMockClient(
    sessionMessages: unknown[],
  ): Promise<{
    captured: string[];
    chatMessage: (input: unknown, output: unknown) => Promise<void>;
  }> {
    const captured: string[] = [];

    const mockClient: any = {
      session: {
        messages: async () => ({ data: sessionMessages }),
        prompt: async (args: any) => {
          // Capture every text the plugin tried to inject.
          const parts = args?.body?.parts ?? [];
          for (const p of parts) {
            if (p && p.type === "text" && typeof p.text === "string") {
              captured.push(p.text);
            }
          }
          return { data: undefined };
        },
        get: async () => ({ data: undefined }),
      },
      app: { log: async () => {} },
    };

    const $ = (() => {}) as any;
    const factory = (await import("./plugin.ts")).SkillsPlugin;
    const result = await factory({
      client: mockClient,
      $,
      directory: projectDir,
      worktree: projectDir,
    } as any);
    const chatMessage = (result as any)["chat.message"] as (
      input: unknown,
      output: unknown,
    ) => Promise<void>;
    return { captured, chatMessage };
  }

function makeOutput(parts: Array<{ type: string; text?: string; synthetic?: boolean }>, sessionID: string = nextSessionID): any {
    return {
      message: {
        sessionID,
        agent: "build",
        model: { modelID: "test-model", providerID: "test" },
      },
      parts,
    };
  }

  test("fresh session (no prior messages) injects <available-skills>", async () => {
    const { captured, chatMessage } = await buildPluginWithMockClient([]);
    await chatMessage({}, makeOutput([{ type: "text", text: "first user message" }]));
    expect(captured.length).toBeGreaterThan(0);
    expect(captured.some((t) => t.includes("<available-skills>"))).toBe(true);
  });

  test("resumed session with prior <available-skills> in messages: setup is detected", async () => {
    const priorMessages = [
      {
        parts: [
          {
            type: "text",
            text: "<available-skills>some skills</available-skills>",
          },
        ],
      },
    ];
    const { captured, chatMessage } = await buildPluginWithMockClient(priorMessages);
    await chatMessage({}, makeOutput([{ type: "text", text: "next user message" }]));

    // Setup was already done — the resume detection should NOT inject another
    // <available-skills> block. It SHOULD run per-message matching, but with
    // no skills discovered (empty project dir), nothing gets injected.
    const availableSkillsInjections = captured.filter((t) =>
      t.includes("<available-skills>"),
    );
    expect(availableSkillsInjections).toHaveLength(0);
  });

  test("resumed session with prior <agent-switch-notice> (only) in messages: setup is detected", async () => {
    // The whole point of adding this tag to RESUME_MARKERS: a session that
    // ran an agent switch on its only prior message has only the switch
    // notice in its history. Without checking this marker, the heuristic
    // would wrongly inject a fresh <available-skills> block.
    const priorMessages = [
      {
        parts: [
          {
            type: "text",
            text: '<agent-switch-notice>Agent changed from "a" to "b"</agent-switch-notice>',
          },
        ],
      },
    ];
    const { captured, chatMessage } = await buildPluginWithMockClient(priorMessages);
    await chatMessage({}, makeOutput([{ type: "text", text: "next user message" }]));

    const availableSkillsInjections = captured.filter((t) =>
      t.includes("<available-skills>"),
    );
    expect(availableSkillsInjections).toHaveLength(0);
  });

  test("session with neither marker in prior messages is treated as fresh", async () => {
    const priorMessages = [
      { parts: [{ type: "text", text: "just user chatter, nothing injected" }] },
    ];
    const { captured, chatMessage } = await buildPluginWithMockClient(priorMessages);
    await chatMessage({}, makeOutput([{ type: "text", text: "next user message" }]));

    expect(captured.some((t) => t.includes("<available-skills>"))).toBe(true);
  });

  test("client.session.messages throwing does NOT crash the chat handler", async () => {
    // Graceful degradation — the resume heuristic lives in a try/catch
    // block; if the SDK call throws, we fall through to the fresh-session
    // path and inject skills normally.
    const captured: string[] = [];
    const mockClient: any = {
      session: {
        messages: async () => {
          throw new Error("network failure");
        },
        prompt: async (args: any) => {
          const parts = args?.body?.parts ?? [];
          for (const p of parts) {
            if (p && p.type === "text" && typeof p.text === "string") {
              captured.push(p.text);
            }
          }
          return { data: undefined };
        },
        get: async () => ({ data: undefined }),
      },
      app: { log: async () => {} },
    };

    const $ = (() => {}) as any;
    const factory = (await import("./plugin.ts")).SkillsPlugin;
    const result = await factory({
      client: mockClient,
      $,
      directory: projectDir,
      worktree: projectDir,
    } as any);
    const handler = (result as any)["chat.message"] as (
      input: unknown,
      output: unknown,
    ) => Promise<void>;

    await handler(
      {},
      makeOutput([{ type: "text", text: "first user message" }]),
    );
    expect(captured.some((t) => t.includes("<available-skills>"))).toBe(true);
  });
});
