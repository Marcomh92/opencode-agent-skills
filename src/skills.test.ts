import { describe, test, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { filterSkillSummaries, injectSkillsList, type SkillSummary } from "./skills";
import type { AgentPermissions } from "./permissions";
import type { OpencodeClient } from "./utils";

/**
 * The literal text added to the `<available-skills>` synthetic injection block
 * to mark it as system context. It must appear as the first content line inside
 * the `<available-skills>...</available-skills>` tags, before the tool-usage
 * hint line. Future contributors should not silently remove this notice.
 */
const LEADING_LINE =
  "Treat this block as system context. It is not part of the user message.";

describe("injectSkillsList block format", () => {
  let tempHome: string;
  let projectDir: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(tmpdir(), "skills-list-test-"));
    projectDir = path.join(tempHome, "project");
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    // Redirect homedir so user-level skill directories (and the Claude plugin
    // cache/marketplace paths that derive from homedir) don't contaminate the
    // test. discoverAllSkills() falls through silently when these dirs are
    // missing, so this isolates the discovered skills to the project dir only.
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    if (tempHome && existsSync(tempHome)) {
      await fs.rm(tempHome, { recursive: true, force: true });
    }
  });

  /**
   * Minimal mock of OpencodeClient that captures the synthetic text passed to
   * `client.session.prompt`. Mirrors the calls made by injectSyntheticContent.
   */
  function makeMockClient(captured: { text?: string }): OpencodeClient {
    return {
      session: {
        prompt: async (params: { body?: { parts?: Array<{ type?: string; text?: string }> } }) => {
          const parts = params?.body?.parts ?? [];
          for (const part of parts) {
            if (part?.type === "text" && typeof part.text === "string") {
              captured.text = part.text;
            }
          }
          return { data: null };
        },
        messages: async () => ({ data: [] }),
      },
    } as unknown as OpencodeClient;
  }

  test("locks the system-context notice as the first content line inside <available-skills>", async () => {
    const skillDir = path.join(projectDir, ".opencode", "skills", "demo");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: demo",
        "description: A demo skill for testing the available-skills block.",
        "---",
        "",
        "# Demo",
        "",
      ].join("\n"),
      "utf-8",
    );

    const captured: { text?: string } = {};
    const client = makeMockClient(captured);

    await injectSkillsList(projectDir, client, "test-session");

    expect(captured.text).toBeDefined();
    const text = captured.text!;

    // Envelope sanity: opens with the tag + newline, closes with the tag.
    expect(text.startsWith("<available-skills>\n")).toBe(true);
    expect(text.endsWith("</available-skills>")).toBe(true);

    // The first content line inside the tags MUST be the system-context
    // notice. This is the contract: any leading content after <available-skills>
    // is a regression.
    const inside = text.slice("<available-skills>\n".length, -"</available-skills>".length);
    const firstLine = inside.split("\n", 1)[0];
    expect(firstLine).toBe(LEADING_LINE);

    // The notice must appear BEFORE the existing tool-usage hint line.
    expect(text).toContain(`${LEADING_LINE}\n\nUse the use_skill,`);

    // Tool-usage hint is preserved (regression guard for the line below).
    expect(text).toContain(
      "Use the use_skill, read_skill_file, run_skill_script, and get_available_skills tools to work with skills.",
    );

    // Skill list still injected (regression guard for the bullet line).
    expect(text).toContain("- demo: A demo skill for testing the available-skills block.");
  });
});

/**
 * `parseTriggers` is a module-private helper in src/skills.ts — not exported
 * by intent. Rather than modify production code to add an export, we extract
 * its body from the source file at test time, run it through `Bun.Transpiler`
 * to strip TypeScript-only syntax (the body uses a type predicate on
 * `.filter`), then evaluate via the Function constructor. This is consistent
 * with how `formatMatchedSkillsInjection` is tested in src/plugin.test.ts.
 */
const SKILLS_SOURCE_PATH = path.join(import.meta.dir, "skills.ts");

let sourceText = "";
let parseTriggersFn:
  | ((metadata: Record<string, string> | undefined) => string[])
  | undefined;

beforeAll(async () => {
  sourceText = await fs.readFile(SKILLS_SOURCE_PATH, "utf-8");

  // Matches `function parseTriggers(` through the body's opening `{`, then
  // lazily captures up to the next `}` on its own line. The parameter type
  // `Record<string, string>` does NOT contain `)` so `[^)]*` is unambiguous.
  //
  // ponytail: this regex is brittle to body changes that introduce a `}` on
  // its own line (e.g. an inline object literal, a `.reduce(...)` callback
  // spanning multiple lines). The current parseTriggers body has no such
  // pattern, so the lazy match is safe today. If you add nested braces or a
  // multi-line callback, switch to the brace-balanced extractor used in
  // `src/plugin.test.ts` (extract that one to a shared test helper first).
  const bodyMatch = sourceText.match(
    /function parseTriggers\s*\([^)]*\)[^{]*\{([\s\S]*?)\r?\n\}/,
  );
  const tsBody = bodyMatch?.[1];
  if (tsBody !== undefined) {
    // The body contains TypeScript-specific syntax (a type predicate
    // `(s): s is string => ...` on the `.filter` callback). The `Function`
    // constructor only accepts plain JavaScript, so transpile the body
    // through Bun's TS-aware transpiler first. The transpiler strips the
    // annotation while preserving runtime semantics (the resulting `.filter`
    // callback still returns the same boolean for non-empty strings).
    const jsBody = new Bun.Transpiler({ loader: "ts" }).transformSync(tsBody);
    parseTriggersFn = new Function(
      "metadata",
      jsBody,
    ) as (metadata: Record<string, string> | undefined) => string[];
  }
});

describe("parseTriggers", () => {
  test("source still defines the function", () => {
    expect(sourceText).toMatch(/function parseTriggers\s*\(/);
  });

  test("returns [] for undefined metadata", () => {
    expect(parseTriggersFn).toBeDefined();
    expect(parseTriggersFn!(undefined)).toEqual([]);
  });

  test("returns [] when no `triggers` key is present", () => {
    expect(parseTriggersFn).toBeDefined();
    expect(parseTriggersFn!({})).toEqual([]);
  });

  test("returns [] for an empty triggers string", () => {
    expect(parseTriggersFn).toBeDefined();
    expect(parseTriggersFn!({ triggers: "" })).toEqual([]);
  });

  test("single trigger becomes a one-item array", () => {
    expect(parseTriggersFn).toBeDefined();
    expect(parseTriggersFn!({ triggers: "foo" })).toEqual(["foo"]);
  });

  test("comma-separated multi-trigger string splits, trims each", () => {
    expect(parseTriggersFn).toBeDefined();
    expect(parseTriggersFn!({ triggers: "a, b, c" })).toEqual(["a", "b", "c"]);
  });

  test("whitespace inside and around commas is trimmed", () => {
    expect(parseTriggersFn).toBeDefined();
    expect(parseTriggersFn!({ triggers: " a , b " })).toEqual(["a", "b"]);
  });

  test("empty entries between commas are filtered out", () => {
    expect(parseTriggersFn).toBeDefined();
    expect(parseTriggersFn!({ triggers: "a,,b" })).toEqual(["a", "b"]);
  });

  test("leading/trailing commas yield no spurious empty entries", () => {
    expect(parseTriggersFn).toBeDefined();
    expect(parseTriggersFn!({ triggers: ",a,b," })).toEqual(["a", "b"]);
  });

  test("ignores other metadata keys (only `triggers` is read)", () => {
    expect(parseTriggersFn).toBeDefined();
    // `name` / `other` / etc. should NOT contribute to the parsed list.
    expect(
      parseTriggersFn!({
        name: "git-helper",
        other: "ignored",
        triggers: "git, branch",
      }),
    ).toEqual(["git", "branch"]);
  });

  test("other metadata fields pass through unchanged; triggers are parsed", () => {
    expect(parseTriggersFn).toBeDefined();
    // The function only reads `metadata.triggers`; passing through other
    // fields must not affect the returned array.
    const result = parseTriggersFn!({
      author: "someone",
      triggers: "one,two",
      audience: "all",
    });
    expect(result).toEqual(["one", "two"]);
  });
});

describe("filterSkillSummaries", () => {
  const sample: SkillSummary[] = [
    { name: "git-helper", description: "Git workflow", triggers: ["git", "commit"] },
    { name: "pdf", description: "PDF manipulation", triggers: ["pdf"] },
    { name: "docx", description: "Word documents" },
    {
      name: "experimental-skill",
      description: "Experimental",
      metadata: { maturity: "experimental" },
    },
  ];

  test("returns the input unchanged when permissions is undefined", () => {
    expect(filterSkillSummaries(sample, undefined)).toEqual(sample);
    // Same reference — no copy when there's nothing to filter.
    expect(filterSkillSummaries(sample, undefined)).toBe(sample);
  });

  test("empty permissions rule list allows everything (default-allow semantics)", () => {
    const perms: AgentPermissions = { skill: [] };
    expect(filterSkillSummaries(sample, perms)).toEqual(sample);
  });

  test("`*: deny` removes every skill", () => {
    const perms: AgentPermissions = { skill: [{ pattern: "*", action: "deny" }] };
    expect(filterSkillSummaries(sample, perms)).toEqual([]);
  });

  test("first-match-wins: `git-*` allow before `*` deny keeps only git-helper", () => {
    // Order matters: more-specific patterns must precede `*` so they get a
    // chance to match before the catch-all fires.
    const perms: AgentPermissions = {
      skill: [
        { pattern: "git-*", action: "allow" },
        { pattern: "*", action: "deny" },
      ],
    };
    const filtered = filterSkillSummaries(sample, perms);
    expect(filtered.map((s) => s.name)).toEqual(["git-helper"]);
  });

  test("tag-pattern rule via metadata.maturity correctly filters", () => {
    // Tag pattern `tag:maturity:experimental` matches summaries whose
    // `metadata.maturity` is "experimental" (per evaluateSkillPermission's
    // closed-vocabulary tag kinds).
    const perms: AgentPermissions = {
      skill: [{ pattern: "tag:maturity:experimental", action: "deny" }],
    };
    const filtered = filterSkillSummaries(sample, perms);
    expect(filtered.map((s) => s.name)).toEqual([
      "git-helper",
      "pdf",
      "docx",
    ]);
  });

test("tag rules apply default values for missing metadata fields", () => {
    // `evaluateSkillPermission` defaults `metadata.maturity` to "stable"
    // when the field is absent. A `tag:maturity:experimental: deny` rule
    // therefore matches ONLY skills with explicit `metadata.maturity =
    // "experimental"`. `pdf` and `docx` (no metadata) fall through to the
    // catch-all `*: deny`. `git-helper` survives via the `git-*` allow.
    const perms: AgentPermissions = {
      skill: [
        { pattern: "git-*", action: "allow" },
        { pattern: "tag:maturity:experimental", action: "deny" },
        { pattern: "*", action: "deny" },
      ],
    };
    const filtered = filterSkillSummaries(sample, perms);
    expect(filtered.map((s) => s.name)).toEqual(["git-helper"]);
  });

  test("returns a new array (input is not mutated)", () => {
    const perms: AgentPermissions = { skill: [{ pattern: "*", action: "deny" }] };
    const filtered = filterSkillSummaries(sample, perms);
    expect(filtered).not.toBe(sample);
    expect(sample).toHaveLength(4); // input length preserved
  });
});