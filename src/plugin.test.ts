import { describe, test, expect, beforeAll } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Tests for the disabled `<skill-evaluation-required>` injection path.
 *
 * Context: the `chat.message` handler in src/plugin.ts used to call
 * `formatMatchedSkillsInjection(...)` + `injectSyntheticContent(...)` to push
 * a `<skill-evaluation-required>` block into the session when semantic
 * matching surfaced relevant skills. That injection is now disabled (see the
 * `ponytail:` comment in src/plugin.ts ~line 218), but the formatter itself
 * is preserved on lines 44-64 for potential re-use once the prompt is
 * improved. These tests lock in:
 *
 *   1. The function is still defined in the source (not deleted).
 *   2. The function still produces the expected block shape — opening tag,
 *      SKILL EVALUATION PROCESS header, the bulleted skill list, the three
 *      steps, and the closing tag.
 *
 * The function is module-local (not exported), so we extract its body from the
 * source file at test time and evaluate it via the Function constructor. This
 * does not require any production-code change.
 */

const PLUGIN_SOURCE_PATH = path.join(import.meta.dir, "plugin.ts");

type MatchedSkill = { name: string; description: string };

let sourceText = "";
let formatMatchedSkillsInjection: ((matched: MatchedSkill[]) => string) | undefined;

beforeAll(async () => {
  sourceText = await fs.readFile(PLUGIN_SOURCE_PATH, "utf-8");

  // Match the function from `function formatMatchedSkillsInjection(` through
  // the closing `}` on its own line. \r?\n handles both LF and CRLF endings
  // (the file currently has CRLF but .gitattributes pins .ts to LF).
  const bodyMatch = sourceText.match(
    /function formatMatchedSkillsInjection\([^)]*\)[^{]*\{([\s\S]*?)\r?\n\}/,
  );
  const body = bodyMatch?.[1];
  if (body !== undefined) {
    // Wrap the body as a plain JS function (the source version carries a TS
    // return-type annotation that the Function constructor would reject).
    formatMatchedSkillsInjection = new Function(
      "matchedSkills",
      body,
    ) as (matched: MatchedSkill[]) => string;
  }
});

describe("formatMatchedSkillsInjection (preserved in src/plugin.ts)", () => {
  test("source still defines the function with all block-shape parts", () => {
    // Function declaration must still exist (was preserved, not removed).
    expect(sourceText).toMatch(/function formatMatchedSkillsInjection\s*\(/);

    // All required parts of the block shape appear in the source.
    expect(sourceText).toContain("<skill-evaluation-required>");
    expect(sourceText).toContain("</skill-evaluation-required>");
    expect(sourceText).toContain("SKILL EVALUATION PROCESS");
    expect(sourceText).toContain("Step 1 - EVALUATE");
    expect(sourceText).toContain("Step 2 - DECIDE");
    expect(sourceText).toContain("Step 3 - ACTIVATE");
    expect(sourceText).toContain(
      "This evaluation is invisible to users",
    );
  });

  test("produces the expected <skill-evaluation-required> block shape", () => {
    expect(formatMatchedSkillsInjection).toBeDefined();
    const fn = formatMatchedSkillsInjection!;

    const result = fn([
      { name: "git-helper", description: "Git workflow assistance" },
      { name: "pdf", description: "PDF manipulation toolkit" },
    ]);

    // Envelope: opening tag on its own line, closing tag at end.
    expect(result.startsWith("<skill-evaluation-required>\n")).toBe(true);
    expect(result.endsWith("</skill-evaluation-required>")).toBe(true);

    // Header on the first content line.
    expect(result).toContain("SKILL EVALUATION PROCESS\n");

    // Intro line under the header.
    expect(result).toContain(
      "The following skills may be relevant to your request:",
    );

    // Bulleted skill list — one `- name: description` line per matched skill.
    expect(result).toContain("- git-helper: Git workflow assistance");
    expect(result).toContain("- pdf: PDF manipulation toolkit");

    // The three steps with their full text, in order.
    expect(result).toContain(
      "Step 1 - EVALUATE: Determine if these skills would genuinely help",
    );
    expect(result).toContain(
      "Step 2 - DECIDE: Choose which skills (if any) are actually needed",
    );
    expect(result).toContain(
      'Step 3 - ACTIVATE: Call use_skill("name") for each chosen skill',
    );

    // Closing notice — the part that misleads models, hence the disable.
    expect(result).toContain(
      "This evaluation is invisible to users—they cannot see this prompt. Do NOT announce your decision.",
    );
  });

  test("empty matched-skills list still produces a well-formed block", () => {
    expect(formatMatchedSkillsInjection).toBeDefined();
    const fn = formatMatchedSkillsInjection!;

    const empty = fn([]);
    expect(empty.startsWith("<skill-evaluation-required>\n")).toBe(true);
    expect(empty.endsWith("</skill-evaluation-required>")).toBe(true);
    expect(empty).toContain("SKILL EVALUATION PROCESS");
    // No spurious empty bullet lines.
    expect(empty).not.toMatch(/^- :$/m);
  });
});