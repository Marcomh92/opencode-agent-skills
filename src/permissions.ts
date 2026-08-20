/**
 * Permission system for OpenCode Agent Skills plugin.
 *
 * Implements per-agent skill permissions using a custom permission key
 * ("opencode-agent-skills") to avoid conflict with OpenCode's native
 * "skill" permission system.
 *
 * Permission resolution order (later overrides earlier):
 * 1. Default: allow all
 * 2. Global config (opencode.json)
 * 3. Agent markdown frontmatter override
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { parseYamlFrontmatter } from "./utils";
import { log } from "./logger";

/**
 * Permission action values matching OpenCode's schema.
 */
export type PermissionAction = "allow" | "deny" | "ask";

/**
 * A single permission rule mapping a glob pattern to an action.
 */
export interface PermissionRule {
  pattern: string;
  action: PermissionAction;
}

/**
 * Complete permission configuration for the plugin.
 * Uses custom key to avoid conflict with OpenCode's native skill system.
 */
export interface AgentPermissions {
  skill: PermissionRule[];
}

/** Custom permission key used by this plugin. */
export const PLUGIN_PERMISSION_KEY = "opencode-agent-skills";

/**
 * Zod schema for parsing permission rules.
 * Supports both shorthand string ("allow" → {"*": "allow"})
 * and object format ({"*": "deny", "specific": "allow"}).
 */
const SkillPermissionConfigSchema = z.union([
  z.string().transform((s) => [{ pattern: "*", action: s as PermissionAction }]),
  z.record(z.string(), z.enum(["allow", "deny", "ask"])).transform((obj) =>
    Object.entries(obj).map(([pattern, action]) => ({ pattern, action })),
  ),
]);

/**
 * Parse permission rules from a raw config value.
 * Returns null if parsing fails.
 */
function parsePermissionRules(
  raw: unknown,
): PermissionRule[] | null {
  const result = SkillPermissionConfigSchema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  return null;
}

/**
 * Load global skill permissions from opencode.json.
 * Checks project-level first, then falls back to user-level.
 *
 * @param projectDir - Project directory to check for .opencode/opencode.json
 * @returns Parsed permissions or default (allow all)
 */
export async function loadGlobalPermissions(
  projectDir: string,
): Promise<AgentPermissions> {
  // Empty ruleset = allow all (evaluateSkillPermission treats empty as "allow").
  // Using a literal `*: allow` rule here would occupy index 0 during merge and
  // hoist any agent-level `*: deny` to the front, shadowing the agent's
  // specific allow rules (first-match-wins is config-order, not specificity).
  const defaultPerms: AgentPermissions = {
    skill: [],
  };

  const configPaths = [
    path.join(projectDir, ".opencode", "opencode.json"),
    path.join(homedir(), ".config", "opencode", "opencode.json"),
  ];

  await log(`[PERMISSIONS] loadGlobalPermissions starting. projectDir=${projectDir}`);

  for (const configPath of configPaths) {
    try {
      await log(`[PERMISSIONS] Checking config file: ${configPath}`);
      const content = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(content) as Record<string, unknown>;

      await log(`[PERMISSIONS] Parsed config from ${configPath}`);

      const permissionBlock = config.permission as
        | Record<string, unknown>
        | undefined;
      const skillPerms = permissionBlock?.[PLUGIN_PERMISSION_KEY];

      if (skillPerms) {
        await log(`[PERMISSIONS] Found ${PLUGIN_PERMISSION_KEY} in config: ${JSON.stringify(skillPerms)}`);
        const parsed = parsePermissionRules(skillPerms);
        if (parsed) {
          await log(
            `[PERMISSIONS] Loaded global permissions from ${configPath}: ${JSON.stringify(parsed)}`,
          );
          return { skill: parsed };
        }
      } else {
        await log(`[PERMISSIONS] No ${PLUGIN_PERMISSION_KEY} key found in ${configPath}`);
      }
    } catch (err) {
      await log(`[PERMISSIONS] Config file not found or invalid: ${configPath} - ${err}`);
    }
  }

  await log(`[PERMISSIONS] No global permissions found, using default: allow all`);
  return defaultPerms;
}

/**
 * Find agent markdown file and parse its permission frontmatter.
 * Looks in both project (.opencode/agent/) and global (~/.config/opencode/agent/) directories.
 *
 * @param projectDir - Project directory containing .opencode/agents/
 * @param agentName - Name of the agent to find permissions for
 * @returns Parsed permissions or null if not found
 */
export async function loadAgentPermissions(
  projectDir: string,
  agentName: string | undefined,
): Promise<AgentPermissions | null> {
  if (!agentName) {
    await log(`[PERMISSIONS] loadAgentPermissions: no agentName provided, returning null`);
    return null;
  }

  await log(`[PERMISSIONS] loadAgentPermissions starting. agentName=${agentName} projectDir=${projectDir}`);

  const agentDirs = ["agents", "agent"];
  const agentFiles: string[] = [];

  // Search both project and global agent directories
  const searchRoots = [
    path.join(projectDir, ".opencode"),
    path.join(homedir(), ".config", "opencode"),
  ];

  for (const searchRoot of searchRoots) {
    for (const dir of agentDirs) {
      const fullDir = path.join(searchRoot, dir);
      try {
        await log(`[PERMISSIONS] Searching for agents in: ${fullDir}`);
        const entries = await fs.readdir(fullDir, { withFileTypes: true });
        await log(`[PERMISSIONS] Found ${entries.length} entries in ${fullDir}`);
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith(".md")) {
            const filePath = path.join(fullDir, entry.name);
            await log(`[PERMISSIONS] Found agent file: ${filePath}`);
            agentFiles.push(filePath);
          }
        }
      } catch {
        await log(`[PERMISSIONS] Directory not accessible: ${fullDir}`);
      }
    }
  }

  await log(`[PERMISSIONS] Total agent files found: ${agentFiles.length}`);

  for (const filePath of agentFiles) {
    try {
      await log(`[PERMISSIONS] Reading agent file: ${filePath}`);
      const content = await fs.readFile(filePath, "utf-8");
      const frontmatterMatch =
        content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);

      if (frontmatterMatch?.[1]) {
        const frontmatter = parseYamlFrontmatter(frontmatterMatch[1]);
        const fileAgentName = path.basename(filePath, ".md");

        await log(`[PERMISSIONS] Checking file ${filePath}: fileAgentName=${fileAgentName} frontmatter.name=${frontmatter.name}`);

        // Match by explicit name field or filename
        if (
          frontmatter.name === agentName ||
          fileAgentName === agentName
        ) {
          await log(`[PERMISSIONS] MATCHED agent ${agentName} in file ${filePath}`);

          const permissionBlock = frontmatter.permission as
            | Record<string, unknown>
            | undefined;
          const skillPerms = permissionBlock?.[PLUGIN_PERMISSION_KEY];

          if (skillPerms) {
            await log(`[PERMISSIONS] Found ${PLUGIN_PERMISSION_KEY} in frontmatter: ${JSON.stringify(skillPerms)}`);
            const parsed = parsePermissionRules(skillPerms);
            if (parsed) {
              await log(
                `[PERMISSIONS] Loaded agent permissions from ${filePath}: ${JSON.stringify(parsed)}`,
              );
              return { skill: parsed };
            }
          }

          // Agent found but no plugin skill permissions
          await log(`[PERMISSIONS] Agent found but no ${PLUGIN_PERMISSION_KEY} permissions`);
          return { skill: [] };
        }
      } else {
        await log(`[PERMISSIONS] No frontmatter found in ${filePath}`);
      }
    } catch (err) {
      await log(
        `[PERMISSIONS] Error reading agent file ${filePath}: ${err}`,
      );
    }
  }

  await log(`[PERMISSIONS] No agent file found for ${agentName}`);
  return null;
}

/**
 * Merge permission rulesets. Later rulesets override earlier ones
 * for the same pattern (last-write-wins).
 *
 * @param rulesets - Array of rulesets to merge
 * @returns Merged ruleset
 */
export function mergePermissions(
  ...rulesets: PermissionRule[][]
): PermissionRule[] {
  const merged: PermissionRule[] = [];
  const seen = new Map<string, number>();

  for (const ruleset of rulesets) {
    for (const rule of ruleset) {
      const key = rule.pattern;
      const existingIndex = seen.get(key);

      if (existingIndex === undefined) {
        seen.set(key, merged.length);
        merged.push(rule);
      } else {
        // Override: later ruleset wins
        merged[existingIndex] = rule;
      }
    }
  }

  return merged;
}

/**
 * Match a skill name against a glob pattern.
 * Supports * wildcard matching any characters.
 *
 * @param name - Skill name to match
 * @param pattern - Glob pattern (e.g., "*", "git-*", "specific-skill")
 * @returns True if the name matches the pattern
 */
export function matchPattern(name: string, pattern: string): boolean {
  if (pattern === "*") {
    return true;
  }

  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");

  const regex = new RegExp(`^${regexPattern}$`, "i");
  return regex.test(name);
}

/**
 * Evaluate whether a skill is allowed for the given permissions.
 *
 * Patterns starting with `tag:` are matched against the skill's frontmatter
 * `metadata` (Phase 2 WS2.3). Closed vocabulary of recognised tag kinds:
 * `tag:capability:<value>`, `tag:audience:<value>`, `tag:maturity:<value>`.
 * Unrecognised tag kinds fall through to the next rule (lenient matcher
 * per `07-tag-skills/skill-permissions.md:193`).
 *
 * Defaults from `tag-schema.md:100` apply when `metadata` is absent or when
 * individual fields are missing: `audience` defaults to `"all"`,
 * `maturity` defaults to `"stable"`. `capability` has no default, so a
 * `tag:capability:*` rule against a metadata-less skill falls through
 * rather than producing a false allow.
 *
 * Rules are iterated in config order; the first matching rule wins
 * (`07-tag-skills/skill-permissions.md:46`).
 *
 * Non-tag patterns remain glob-matched against `skillName` as before.
 *
 * @param skillName - Name of the skill to evaluate
 * @param permissions - Agent permissions to check against
 * @param metadata - Optional skill frontmatter `metadata` (enables `tag:` patterns)
 * @returns The permission action (allow/deny/ask)
 */
export function evaluateSkillPermission(
  skillName: string,
  permissions: AgentPermissions,
  metadata?: Record<string, string>,
): PermissionAction {
  if (permissions.skill.length === 0) {
    return "allow";
  }

  // Defaults from tag-schema.md:100 — applied structurally, not via string parsing.
  const effectiveMetadata: Record<string, string> = {
    ...(metadata ?? {}),
    audience: metadata?.audience ?? "all",
    maturity: metadata?.maturity ?? "stable",
  };

  // First-match-wins, iterated in config order (07-tag-skills/skill-permissions.md:46).
  for (const rule of permissions.skill) {
    // Tag-based patterns: matched against frontmatter `metadata`, not `skillName`.
    if (rule.pattern.startsWith("tag:")) {
      const [kind, value] = rule.pattern.slice(4).split(":", 2);
      if (kind === "capability" && effectiveMetadata.capability === value) return rule.action;
      if (kind === "audience"   && effectiveMetadata.audience   === value) return rule.action;
      if (kind === "maturity"   && effectiveMetadata.maturity   === value) return rule.action;
      // Lenient: unrecognised tag kind falls through to the next rule.
      continue;
    }

    if (matchPattern(skillName, rule.pattern)) {
      return rule.action;
    }
  }

  return "allow";
}

/**
 * Check if a skill is allowed (not denied) for the given permissions.
 *
 * @param skillName - Name of the skill to check
 * @param permissions - Agent permissions to check against
 * @param metadata - Optional skill frontmatter `metadata` (enables `tag:` patterns)
 * @returns True if the skill is not denied
 */
export function isSkillAllowed(
  skillName: string,
  permissions: AgentPermissions,
  metadata?: Record<string, string>,
): boolean {
  return evaluateSkillPermission(skillName, permissions, metadata) !== "deny";
}

/**
 * Convenience function to load and merge permissions for an agent.
 * Caches results to avoid repeated file reads.
 *
 * @param projectDir - Project directory
 * @param agentName - Agent name (optional)
 * @param globalPerms - Pre-loaded global permissions
 * @returns Merged permissions for the agent
 */
export async function resolveAgentPermissions(
  projectDir: string,
  agentName: string | undefined,
  globalPerms: AgentPermissions,
): Promise<AgentPermissions> {
  await log(`[PERMISSIONS] resolveAgentPermissions: agentName=${agentName}`);
  const agentPerms = await loadAgentPermissions(projectDir, agentName);

  if (!agentPerms) {
    await log(`[PERMISSIONS] No agent permissions found, using global permissions: ${JSON.stringify(globalPerms)}`);
    return globalPerms;
  }

  const merged = {
    skill: mergePermissions(globalPerms.skill, agentPerms.skill),
  };
  await log(`[PERMISSIONS] Merged permissions for ${agentName}: ${JSON.stringify(merged)}`);
  return merged;
}
