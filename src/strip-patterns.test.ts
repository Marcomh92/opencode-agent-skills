import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  DEFAULT_STRIP_PATTERNS,
  compileStripPattern,
  containsSystemBlock,
  loadStripPatterns,
  stripText,
} from "./strip-patterns";

describe("DEFAULT_STRIP_PATTERNS", () => {
  test("includes <available-skills> and <available-subagents>", () => {
    expect(DEFAULT_STRIP_PATTERNS).toContain("<available-skills>");
    expect(DEFAULT_STRIP_PATTERNS).toContain("<available-subagents>");
  });

  test("includes the plugin's own <relevant-skills> and <agent-switch-notice> blocks", () => {
    // If a user pastes a previous LLM response or another session's
    // transcript, these blocks contain trigger words ("skill", "use_skill",
    // "task") that would pollute the matcher query. Stripping them by
    // default prevents self-pollution.
    expect(DEFAULT_STRIP_PATTERNS).toContain("<relevant-skills>");
    expect(DEFAULT_STRIP_PATTERNS).toContain("<agent-switch-notice>");
  });
});

describe("stripText", () => {
  describe("block-name patterns (<name>)", () => {
    test("strips a <available-skills>...</available-skills> block entirely", () => {
      const text = "before <available-skills>some content</available-skills> after";
      const result = stripText(text, ["<available-skills>"]);
      expect(result).toBe("before  after");
      expect(result).not.toContain("<available-skills>");
      expect(result).not.toContain("some content");
    });

    test("strips multi-line block content via lazy quantifier", () => {
      const text = "before\n<available-skills>\nline 1\nline 2\nline 3\n</available-skills>\nafter";
      const result = stripText(text, ["<available-skills>"]);
      // Both the opening and closing tags get removed, leaving the surrounding
      // text with the block collapsed to nothing between the surrounding newlines.
      expect(result).not.toContain("<available-skills>");
      expect(result).not.toContain("line 1");
      expect(result).not.toContain("line 2");
      expect(result).not.toContain("line 3");
      expect(result.startsWith("before")).toBe(true);
      expect(result.endsWith("after")).toBe(true);
    });

    test("handles underscore-containing block names like <task_result>", () => {
      const text = "alpha <task_result>x and y</task_result> beta";
      const result = stripText(text, ["<task_result>"]);
      expect(result).toBe("alpha  beta");
    });

    test("removes multiple occurrences of the same block", () => {
      const text = "<x>1</x> middle <x>2</x> end";
      const result = stripText(text, ["<x>"]);
      expect(result).toBe(" middle  end");
    });

    test("does NOT match a different block name", () => {
      const text = "<foo>content</foo>";
      const result = stripText(text, ["<bar>"]);
      expect(result).toBe("<foo>content</foo>");
    });

    test("leaves the opening tag alone if the closing tag is missing", () => {
      // Lazy quantifier: the regex requires the close to match. Without it,
      // the unmatched block stays.
      const text = "before <available-skills>open ended here";
      const result = stripText(text, ["<available-skills>"]);
      expect(result).toBe("before <available-skills>open ended here");
    });
  });

  describe("literal-substring patterns", () => {
    test("strips a literal substring like [TODO]", () => {
      const result = stripText("hello [TODO] world", ["[TODO]"]);
      expect(result).toBe("hello  world");
    });

    test("strips a multi-token literal substring like 'End of section'", () => {
      const result = stripText("Above\nEnd of section\nBelow", ["End of section"]);
      expect(result).toBe("Above\n\nBelow");
    });

    test("removes multiple occurrences of the same literal", () => {
      const result = stripText("[TODO] a [TODO] b [TODO] c", ["[TODO]"]);
      expect(result).toBe(" a  b  c");
    });
  });

  describe("regex-meta-char escaping in literal patterns", () => {
    test("[XYZ] is a literal substring, NOT a character class", () => {
      const text = "[XYZ] marker";
      const result = stripText(text, ["[XYZ]"]);
      expect(result).toBe(" marker");
    });

    test("[XYZ] literal does NOT strip 'X', 'Y', or 'Z' alone", () => {
      const result1 = stripText("X standalone", ["[XYZ]"]);
      const result2 = stripText("Y standalone", ["[XYZ]"]);
      const result3 = stripText("Z standalone", ["[XYZ]"]);
      expect(result1).toBe("X standalone");
      expect(result2).toBe("Y standalone");
      expect(result3).toBe("Z standalone");
    });

    test("foo.bar literal does not match fooXbar (no regex '.'-wildcard leakage)", () => {
      const result1 = stripText("foo.bar", ["foo.bar"]);
      const result2 = stripText("fooXbar", ["foo.bar"]);
      expect(result1).toBe("");
      expect(result2).toBe("fooXbar");
    });

    test("common regex special chars in literals are escaped", () => {
      // * without escaping would match anywhere; escaped literal matches only "* here".
      const result1 = stripText("* here", ["*"]);
      const result2 = stripText("nope", ["*"]);
      expect(result1).toBe(" here");
      expect(result2).toBe("nope");
    });
  });

  describe("mixed block-name + literal patterns in one call", () => {
    test("strips block + literal + block in pattern-list order", () => {
      const text = "<x>foo</x> middle [TODO] end <y>bar</y>";
      const result = stripText(text, ["<x>", "[TODO]", "<y>"]);
      expect(result).toBe(" middle  end ");
    });
  });

  describe("defensive behavior", () => {
    test("empty patterns array returns input unchanged", () => {
      const input = "leave me <available-skills>alone</available-skills>";
      expect(stripText(input, [])).toBe(input);
    });

    test("undefined patterns (cast through any) returns input unchanged", () => {
      // Production signature is `readonly string[]` so passing undefined
      // requires a cast. The defensive `!patterns` check on the function's
      // first line covers this — verify it doesn't crash.
      const input = "leave me alone";
      expect(stripText(input, undefined as unknown as readonly string[])).toBe(input);
    });

    test("is idempotent: running stripText twice yields the same output", () => {
      const text = "<x>foo</x> and [TODO] bar";
      const patterns = ["<x>", "[TODO]"];
      const once = stripText(text, patterns);
      const twice = stripText(once, patterns);
      expect(twice).toBe(once);
    });

    test("does not crash on text with no matches", () => {
      const input = "nothing to see here";
      const result = stripText(input, ["<available-skills>", "[TODO]"]);
      expect(result).toBe(input);
    });
  });
});

describe("compileStripPattern", () => {
  test("block-name pattern produces a global regex matching the whole block lazily", () => {
    const re = compileStripPattern("<x>");
    expect(re.global).toBe(true);
    const text = "<x>first</x> between <x>second</x>";
    expect(text.replace(re, "")).toBe(" between ");
  });

  test("literal pattern produces a global regex matching substring", () => {
    const re = compileStripPattern("[TODO]");
    expect(re.global).toBe(true);
    const text = "a [TODO] b [TODO] c";
    expect(text.replace(re, "")).toBe("a  b  c");
  });

  test("empty string pattern compiles without throwing and yields a global regex", () => {
    // Empty string doesn't match `/^<[^>]+>$/` (which requires `+`) and has
    // no special chars for `escapeRegex` to handle, so it falls through to a
    // literal `new RegExp("", "g")`. Lock the compile contract (global flag
    // set, no throw); the replace outcome of a zero-width regex varies across
    // JS runtimes and is intentionally left out of scope.
    const re = compileStripPattern("");
    expect(re.global).toBe(true);
    expect(typeof re.test("anything")).toBe("boolean");
  });
});

describe("containsSystemBlock", () => {
  test("returns true for content with an <available-skills>...</available-skills> block", () => {
    const text = "before\n<available-skills>some skills</available-skills>\nafter";
    expect(containsSystemBlock(text, "available-skills")).toBe(true);
  });

  test("returns false when the block is absent", () => {
    const text = "regular text only — no system block here";
    expect(containsSystemBlock(text, "available-skills")).toBe(false);
  });

  test("returns false when the closing tag is missing (regex requires close)", () => {
    const text = "missing closing <available-skills>open block content";
    expect(containsSystemBlock(text, "available-skills")).toBe(false);
  });

  test("uses the block-name shape — bare literal name is NOT detected as a block", () => {
    // `containsSystemBlock` always treats the second arg as a block name
    // (compileStripPattern(`<${name}>`)). A stray literal "available-skills"
    // without angle-brackets does not match.
    const text = "just the literal name available-skills here, no tags";
    expect(containsSystemBlock(text, "available-skills")).toBe(false);
  });

  test("detects a different block name when asked", () => {
    const text = "<task_result>complete</task_result>";
    expect(containsSystemBlock(text, "task_result")).toBe(true);
    expect(containsSystemBlock(text, "other_name")).toBe(false);
  });

  test("detects <agent-switch-notice> blocks (used by the resume heuristic)", () => {
    // Regression guard: src/plugin.ts:58 RESUME_MARKERS includes
    // "agent-switch-notice". If `compileStripPattern` regresses and stops
    // matching multi-word / hyphenated names, the resume heuristic would
    // silently stop detecting agent switches.
    const text = "previous <agent-switch-notice>Agent changed from \"a\" to \"b\"</agent-switch-notice> here";
    expect(containsSystemBlock(text, "agent-switch-notice")).toBe(true);
    expect(containsSystemBlock("no notice here", "agent-switch-notice")).toBe(false);
  });
});

describe("loadStripPatterns", () => {
  let tempHome: string;
  let projectDir: string;
  let userOpencodeDir: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalLogEnv: string | undefined;

  beforeEach(async () => {
    // Make a fresh temp tree for each test so they don't share state.
    tempHome = await fs.mkdtemp(path.join(tmpdir(), "strip-patterns-test-"));
    projectDir = path.join(tempHome, "project");
    userOpencodeDir = path.join(tempHome, ".config", "opencode");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(userOpencodeDir, { recursive: true });

    // Redirect homedir-related env vars so homedir() returns our temp dir.
    // `loadStripPatterns` reads the user-level config from
    // `<homedir()>/.config/opencode/opencode.json`.
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;

    // Also keep the logger pointed at our temp dir so test output doesn't
    // pollute the user's real log file.
    originalLogEnv = process.env.OPENCODE_AGENT_SKILLS_LOG_FILE;
    process.env.OPENCODE_AGENT_SKILLS_LOG_FILE = path.join(tempHome, "debug.log");
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    if (originalLogEnv === undefined) delete process.env.OPENCODE_AGENT_SKILLS_LOG_FILE;
    else process.env.OPENCODE_AGENT_SKILLS_LOG_FILE = originalLogEnv;

    if (tempHome && existsSync(tempHome)) {
      await fs.rm(tempHome, { recursive: true, force: true });
    }
  });

  test("returns DEFAULT_STRIP_PATTERNS when no config file is present", async () => {
    const result = await loadStripPatterns(projectDir);
    expect(result).toEqual(DEFAULT_STRIP_PATTERNS);
  });

  test("reads stripPatterns from project-level opencode.json", async () => {
    const projectConfig = path.join(projectDir, ".opencode", "opencode.json");
    await fs.mkdir(path.dirname(projectConfig), { recursive: true });
    await fs.writeFile(
      projectConfig,
      JSON.stringify({
        "opencode-agent-skills": {
          stripPatterns: ["<x>", "<y>", "[TODO]"],
        },
      }),
      "utf-8",
    );

    const result = await loadStripPatterns(projectDir);
    expect(result).toEqual(["<x>", "<y>", "[TODO]"]);
  });

  test("reads from user-level opencode.json when the project has no config", async () => {
    const userConfig = path.join(userOpencodeDir, "opencode.json");
    await fs.writeFile(
      userConfig,
      JSON.stringify({
        "opencode-agent-skills": {
          stripPatterns: ["<user-only>"],
        },
      }),
      "utf-8",
    );

    const result = await loadStripPatterns(projectDir);
    expect(result).toEqual(["<user-only>"]);
  });

  test("project-level config takes precedence over user-level", async () => {
    const projectConfig = path.join(projectDir, ".opencode", "opencode.json");
    await fs.mkdir(path.dirname(projectConfig), { recursive: true });
    await fs.writeFile(
      projectConfig,
      JSON.stringify({
        "opencode-agent-skills": { stripPatterns: ["<project-tag>"] },
      }),
      "utf-8",
    );
    const userConfig = path.join(userOpencodeDir, "opencode.json");
    await fs.writeFile(
      userConfig,
      JSON.stringify({
        "opencode-agent-skills": { stripPatterns: ["<user-tag>"] },
      }),
      "utf-8",
    );

    const result = await loadStripPatterns(projectDir);
    expect(result).toEqual(["<project-tag>"]);
  });

  test("falls back to default when validation fails (array contains non-strings)", async () => {
    const projectConfig = path.join(projectDir, ".opencode", "opencode.json");
    await fs.mkdir(path.dirname(projectConfig), { recursive: true });
    await fs.writeFile(
      projectConfig,
      JSON.stringify({
        "opencode-agent-skills": { stripPatterns: [42, true, "ok"] },
      }),
      "utf-8",
    );

    const result = await loadStripPatterns(projectDir);
    expect(result).toEqual(DEFAULT_STRIP_PATTERNS);
  });

  test("falls back to default when over the max-32 cap", async () => {
    const tooMany = Array.from({ length: 33 }, (_, i) => `<p${i}>`);
    const projectConfig = path.join(projectDir, ".opencode", "opencode.json");
    await fs.mkdir(path.dirname(projectConfig), { recursive: true });
    await fs.writeFile(
      projectConfig,
      JSON.stringify({
        "opencode-agent-skills": { stripPatterns: tooMany },
      }),
      "utf-8",
    );

    const result = await loadStripPatterns(projectDir);
    expect(result).toEqual(DEFAULT_STRIP_PATTERNS);
  });

  test("accepts a 32-item array as valid (boundary)", async () => {
    const exactly32 = Array.from({ length: 32 }, (_, i) => `<p${i}>`);
    const projectConfig = path.join(projectDir, ".opencode", "opencode.json");
    await fs.mkdir(path.dirname(projectConfig), { recursive: true });
    await fs.writeFile(
      projectConfig,
      JSON.stringify({
        "opencode-agent-skills": { stripPatterns: exactly32 },
      }),
      "utf-8",
    );

    const result = await loadStripPatterns(projectDir);
    expect(result).toEqual(exactly32);
  });

  test("tolerates malformed JSON gracefully (returns default)", async () => {
    const projectConfig = path.join(projectDir, ".opencode", "opencode.json");
    await fs.mkdir(path.dirname(projectConfig), { recursive: true });
    await fs.writeFile(projectConfig, "{ not valid json", "utf-8");

    const result = await loadStripPatterns(projectDir);
    expect(result).toEqual(DEFAULT_STRIP_PATTERNS);
  });

  test("ignores config when 'opencode-agent-skills' block has no stripPatterns key", async () => {
    const projectConfig = path.join(projectDir, ".opencode", "opencode.json");
    await fs.mkdir(path.dirname(projectConfig), { recursive: true });
    await fs.writeFile(
      projectConfig,
      JSON.stringify({
        "opencode-agent-skills": { differentKey: ["<x>"] },
        "some-other-plugin": { stripPatterns: ["<ignored>"] },
      }),
      "utf-8",
    );

    const result = await loadStripPatterns(projectDir);
    // Project config exists but the key is missing → keep looking → no user
    // config → default.
    expect(result).toEqual(DEFAULT_STRIP_PATTERNS);
  });

  test("empty array is a valid config value (no patterns to strip)", async () => {
    const projectConfig = path.join(projectDir, ".opencode", "opencode.json");
    await fs.mkdir(path.dirname(projectConfig), { recursive: true });
    await fs.writeFile(
      projectConfig,
      JSON.stringify({
        "opencode-agent-skills": { stripPatterns: [] },
      }),
      "utf-8",
    );

    const result = await loadStripPatterns(projectDir);
    expect(result).toEqual([]);
  });

  test("returns a fresh default copy per call (caller mutation does not leak)", async () => {
    // Production uses `[...DEFAULT_STRIP_PATTERNS]` so a `push` from one caller
    // does not affect the next. Two consecutive loads should yield distinct
    // array identities that compare deeply equal.
    const a = await loadStripPatterns(projectDir);
    const b = await loadStripPatterns(projectDir);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);

    a.push("<mutated>");
    expect(b).not.toContain("<mutated>");

    // And the module-level constant itself must never have grown.
    expect(DEFAULT_STRIP_PATTERNS).not.toContain("<mutated>");
  });
});
