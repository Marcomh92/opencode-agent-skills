/**
 * Strip-pattern primitives + `opencode.json` config loader.
 *
 * The `compileStripPattern` / `stripText` / `containsSystemBlock` primitives
 * are copied verbatim from the sibling plugin
 * `opencode-dynamic-context-pruning-fork/lib/messages/strip-patterns.ts`
 * so both plugins share the same mental model of how user-configured
 * patterns map to regexes. The plugin-specific config plumbing from that
 * sibling (their layered `dcp.jsonc` merge) is NOT copied — this plugin
 * uses its own Zod + `opencode.json` pattern (mirrors
 * `loadGlobalPermissions` in `src/permissions.ts`).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { log } from "./logger";

/**
 * Defaults — what every session strips when no config is present. Includes:
 * - The two legacy blocks other plugins inject (`<available-skills>`,
 *   `<available-subagents>`)
 * - This plugin's own per-message injection (`<relevant-skills>`) — if a user
 *   pastes a previous LLM response or another session's transcript, this
 *   block's literal text contains "skill", "use_skill", "task" triggers that
 *   would otherwise pollute the matcher query.
 * - The agent-switch marker (`<agent-switch-notice>`) — same self-pollution
 *   risk if a user pastes the notice into the chat.
 */
export const DEFAULT_STRIP_PATTERNS: string[] = [
  "<available-skills>",
  "<available-subagents>",
  "<relevant-skills>",
  "<agent-switch-notice>",
];

// ponytail: regex special chars from MDN; covers all escape requirements for
// literal substring matching. Plain-text patterns from user config must not
// inject regex syntax into a compiled RegExp.
const REGEX_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;
// Exported for parity with the sibling plugin (which exports it too); not
// currently consumed by other modules but available for tests / future callers.
export function escapeRegex(s: string): string {
  return s.replace(REGEX_SPECIAL_CHARS, "\\$&");
}

/**
 * Compile one user pattern into a global regex.
 * - `<name>` (single angle-bracketed tag, no other `>`): matches the entire
 *   `<name>...</name>` block including content. Lazy match. Matches the
 *   `<available-skills>...</available-skills>` shape that plugins use.
 * - anything else: literal substring match (regex special chars escaped).
 *
 * ponytail: two-mode because the block-name case is what users actually write
 * (`<available-skills>`); literal-substring is the fallback for arbitrary
 * strings (`[TODO]`, `End of section`, etc.). Add a third mode (full regex
 * passthrough) when a user needs anchor semantics.
 */
export const compileStripPattern = (pattern: string): RegExp => {
  if (/^<[^>]+>$/.test(pattern)) {
    const name = pattern.slice(1, -1);
    return new RegExp(`<${escapeRegex(name)}>[\\s\\S]*?</${escapeRegex(name)}>`, "g");
  }
  return new RegExp(escapeRegex(pattern), "g");
};

/**
 * Strip matching text patterns from a single string. Each entry in `patterns`
 * is interpreted by `compileStripPattern`: `<name>` becomes a whole-block
 * match; any other string becomes a literal substring. Returns the input
 * unchanged when `patterns` is empty. Idempotent — re-running on already-
 * stripped text is a no-op. Compile-once-strip-many: caller pays the regex
 * compile cost once per call regardless of how many patterns are listed.
 */
export function stripText(text: string, patterns: readonly string[]): string {
  if (!patterns || patterns.length === 0) return text;
  // ponytail: pre-compile once per fire; reuse the regex across all parts.
  // Avoids per-part recompile on hot path (every LLM fetch).
  const compiled = patterns.map(compileStripPattern);
  let next = text;
  for (const re of compiled) {
    next = next.replace(re, "");
  }
  return next;
}

/**
 * Test whether `text` contains a system-injected block whose tag name is
 * `name`. Shares the `compileStripPattern` parser so the test regex shape
 * matches what `stripText` would actually remove. Used by the resume heuristic
 * in `src/plugin.ts` to detect a previously-injected `<available-skills>` (or
 * similar) block when the session is resumed.
 */
export function containsSystemBlock(text: string, name: string): boolean {
  return compileStripPattern(`<${name}>`).test(text);
}

// ponytail: hard cap matches the sibling plugin. Beyond ~32 patterns the regex
// compile + chain becomes a hot-path concern; users with >32 blocks should
// consolidate rather than enumerate.
const MAX_STRIP_PATTERNS = 32;

/**
 * Shared layered reader for keys under the top-level `opencode-agent-skills`
 * namespace. Lookup order:
 * 1. `<projectDir>/.opencode/opencode.json`
 * 2. `~/.config/opencode/opencode.json`
 *
 * Returns the first valid value for `key` in a config file, or `undefined`
 * when neither file defines a valid value. Callers supply their own default.
 * Always logs its traversal; file I/O errors are logged and skipped.
 */
async function readPluginConfigKey(
  projectDir: string,
  key: string,
  schema: z.ZodType,
): Promise<unknown | undefined> {
  const configPaths = [
    path.join(projectDir, ".opencode", "opencode.json"),
    path.join(homedir(), ".config", "opencode", "opencode.json"),
  ];

  for (const configPath of configPaths) {
    try {
      await log(`[CONFIG] Checking ${key} in config file: ${configPath}`);
      const content = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(content) as Record<string, unknown>;

      const pluginBlock = config["opencode-agent-skills"] as
        | Record<string, unknown>
        | undefined;
      const raw = pluginBlock?.[key];

      if (raw === undefined) {
        await log(`[CONFIG] No ${key} key in ${configPath}`);
        continue;
      }

      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        await log(`[CONFIG] Invalid ${key} in ${configPath}: ${parsed.error.message}`);
        continue;
      }

      await log(`[CONFIG] Loaded ${key} from ${configPath}: ${JSON.stringify(parsed.data)}`);
      return parsed.data;
    } catch (err) {
      await log(`[CONFIG] Config file not found or invalid: ${configPath} - ${err}`);
    }
  }

  return undefined;
}

/**
 * Load strip-pattern overrides from `opencode.json`. Reads the top-level
 * `opencode-agent-skills.stripPatterns` key (a `string[]`). Falls back to
 * `DEFAULT_STRIP_PATTERNS` when neither file contains the key or when
 * validation fails. Always succeeds — file I/O errors are logged and the
 * default is returned.
 *
 * Mirrors `loadGlobalPermissions` (`src/permissions.ts:78`) — same layered
 * config pattern, same graceful-degradation contract.
 */
export async function loadStripPatterns(projectDir: string): Promise<string[]> {
  const value = await readPluginConfigKey(
    projectDir,
    "stripPatterns",
    z.array(z.string()).max(MAX_STRIP_PATTERNS),
  );
  if (value !== undefined) return value as string[];
  await log(
    `[STRIP-PATTERNS] No stripPatterns found, using default: ${JSON.stringify(DEFAULT_STRIP_PATTERNS)}`,
  );
  return [...DEFAULT_STRIP_PATTERNS];
}

/**
 * Default for the `<relevant-skills>` rendering: include each skill's
 * description, not just the title + relevance tier.
 */
export const DEFAULT_INCLUDE_SKILL_DESCRIPTIONS = true;

/**
 * Load whether the `<relevant-skills>` block should include each skill's full
 * description or only the title + relevance tier. Reads the top-level
 * `opencode-agent-skills.includeSkillDescriptions` key (a `boolean`). Falls
 * back to `DEFAULT_INCLUDE_SKILL_DESCRIPTIONS` (true) when absent or invalid.
 * Always succeeds.
 */
export async function loadRelevantSkillConfig(
  projectDir: string,
): Promise<{ includeSkillDescriptions: boolean }> {
  const value = await readPluginConfigKey(projectDir, "includeSkillDescriptions", z.boolean());
  if (value !== undefined) return { includeSkillDescriptions: value as boolean };
  await log(
    `[SKILLS PLUGIN] No includeSkillDescriptions found, using default: ${DEFAULT_INCLUDE_SKILL_DESCRIPTIONS}`,
  );
  return { includeSkillDescriptions: DEFAULT_INCLUDE_SKILL_DESCRIPTIONS };
}
