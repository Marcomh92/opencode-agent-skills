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
  const defaultPerms: AgentPermissions = {
    skill: [{ pattern: "*", action: "allow" }],
  };

  const configPaths = [
    path.join(projectDir, ".opencode", "opencode.json"),
    path.join(homedir(), ".config", "opencode", "opencode.json"),
  ];

  for (const configPath of configPaths) {
    try {
      const content = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(content) as Record<string, unknown>;

      const permissionBlock = config.permission as
        | Record<string, unknown>
        | undefined;
      const skillPerms = permissionBlock?.[PLUGIN_PERMISSION_KEY];

      if (skillPerms) {
        const parsed = parsePermissionRules(skillPerms);
        if (parsed) {
          await log(
            `[PERMISSIONS] Loaded global permissions from ${configPath}`,
          );
          return { skill: parsed };
        }
      }
    } catch {
      // File doesn't exist or is invalid — continue to next path
    }
  }

  return defaultPerms;
}

/**
 * Find agent markdown file and parse its permission frontmatter.
 * Looks in .opencode/agents/ and .opencode/agent/ for .md files matching agent name.
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
    return null;
  }

  const agentDirs = ["agents", "agent"];
  const agentFiles: string[] = [];

  for (const dir of agentDirs) {
    const fullDir = path.join(projectDir, ".opencode", dir);
    try {
      const entries = await fs.readdir(fullDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          agentFiles.push(path.join(fullDir, entry.name));
        }
      }
    } catch {
      // Directory doesn't exist — skip
    }
  }

  for (const filePath of agentFiles) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const frontmatterMatch =
        content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);

      if (frontmatterMatch?.[1]) {
        const frontmatter = parseYamlFrontmatter(frontmatterMatch[1]);
        const fileAgentName = path.basename(filePath, ".md");

        // Match by explicit name field or filename
        if (
          frontmatter.name === agentName ||
          fileAgentName === agentName
        ) {
          const permissionBlock = frontmatter.permission as
            | Record<string, unknown>
            | undefined;
          const skillPerms = permissionBlock?.[PLUGIN_PERMISSION_KEY];

          if (skillPerms) {
            const parsed = parsePermissionRules(skillPerms);
            if (parsed) {
              await log(
                `[PERMISSIONS] Loaded agent permissions from ${filePath}`,
              );
              return { skill: parsed };
            }
          }

          // Agent found but no plugin skill permissions
          return { skill: [] };
        }
      }
    } catch (err) {
      await log(
        `[PERMISSIONS] Error reading agent file ${filePath}: ${err}`,
      );
    }
  }

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
 * Returns the action for the first matching pattern, checking
 * specific patterns before wildcards.
 *
 * @param skillName - Name of the skill to evaluate
 * @param permissions - Agent permissions to check against
 * @returns The permission action (allow/deny/ask)
 */
export function evaluateSkillPermission(
  skillName: string,
  permissions: AgentPermissions,
): PermissionAction {
  if (permissions.skill.length === 0) {
    return "allow";
  }

  // Sort: specific patterns first, then wildcards
  const sorted = [...permissions.skill].sort((a, b) => {
    if (a.pattern === "*" && b.pattern !== "*") return 1;
    if (b.pattern === "*" && a.pattern !== "*") return -1;
    return b.pattern.length - a.pattern.length;
  });

  for (const rule of sorted) {
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
 * @returns True if the skill is not denied
 */
export function isSkillAllowed(
  skillName: string,
  permissions: AgentPermissions,
): boolean {
  return evaluateSkillPermission(skillName, permissions) !== "deny";
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
  const agentPerms = await loadAgentPermissions(projectDir, agentName);

  if (!agentPerms) {
    return globalPerms;
  }

  return {
    skill: mergePermissions(globalPerms.skill, agentPerms.skill),
  };
}
