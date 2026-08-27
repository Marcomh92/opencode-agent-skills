import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { injectSkillsList } from "./skills";
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