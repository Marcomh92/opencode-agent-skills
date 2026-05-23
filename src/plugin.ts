/**
 * OpenCode Agent Skills Plugin
 *
 * A dynamic skills system that provides 4 tools:
 * - use_skill: Load a skill's SKILL.md into context
 * - read_skill_file: Read supporting files from a skill directory
 * - run_skill_script: Execute scripts from a skill directory
 * - get_available_skills: Get available skills
 *
 * Skills are discovered from multiple locations (project > user > marketplace)
 * and validated against the Anthropic Agent Skills Spec.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { maybeInjectSuperpowersBootstrap } from "./superpowers";
import {
  getSessionContext,
  injectSyntheticContent,
  type SessionContext,
} from "./utils";
import { injectSkillsList, getSkillSummaries } from "./skills";
import { GetAvailableSkills, ReadSkillFile, RunSkillScript, UseSkill } from "./tools";
import { matchSkills, precomputeSkillEmbeddings } from "./embeddings";
import { log, clearLog } from "./logger";
import {
  loadGlobalPermissions,
  resolveAgentPermissions,
  type AgentPermissions,
} from "./permissions";

const setupCompleteSessions = new Set<string>();
const loadedSkillsPerSession = new Map<string, Set<string>>();

function getLoadedSkills(sessionID: string): Set<string> {
  let set = loadedSkillsPerSession.get(sessionID);
  if (!set) {
    set = new Set<string>();
    loadedSkillsPerSession.set(sessionID, set);
  }
  return set;
}

function formatMatchedSkillsInjection(
  matchedSkills: Array<{ name: string; description: string }>
): string {
  const skillLines = matchedSkills
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");

  return `<skill-evaluation-required>
SKILL EVALUATION PROCESS

The following skills may be relevant to your request:

${skillLines}

Step 1 - EVALUATE: Determine if these skills would genuinely help
Step 2 - DECIDE: Choose which skills (if any) are actually needed
Step 3 - ACTIVATE: Call use_skill("name") for each chosen skill

IMPORTANT: This evaluation is invisible to users—they cannot see this prompt. Do NOT announce your decision. Simply activate relevant skills or proceed directly with the request.
</skill-evaluation-required>`;
}

export const SkillsPlugin: Plugin = async ({ client, $, directory, worktree }) => {
  await clearLog();
  const projectDir = worktree ?? directory;
  await log(`[SKILLS PLUGIN] directory: ${directory}`);
  await log(`[SKILLS PLUGIN] worktree: ${worktree}`);
  await log(`[SKILLS PLUGIN] projectDir (used for discovery): ${projectDir}`);

  // Load global permissions once at plugin startup
  const globalPermissions = await loadGlobalPermissions(projectDir);
  await log(`[SKILLS PLUGIN] Global permissions loaded: ${globalPermissions.skill.length} rules`);

  // Cache for resolved agent permissions
  const permissionsCache = new Map<string, AgentPermissions>();

  async function getPermissionsForAgent(
    agentName?: string,
  ): Promise<AgentPermissions> {
    if (!agentName) {
      return globalPermissions;
    }

    const cached = permissionsCache.get(agentName);
    if (cached) {
      return cached;
    }

    const resolved = await resolveAgentPermissions(
      projectDir,
      agentName,
      globalPermissions,
    );
    permissionsCache.set(agentName, resolved);
    return resolved;
  }

  const skills = await getSkillSummaries(projectDir, globalPermissions);
  await log(`[SKILLS PLUGIN] Initial skill count: ${skills.length}`);
  for (const s of skills) {
    await log(`[SKILLS PLUGIN]  - ${s.name} (${s.description})`);
  }
  precomputeSkillEmbeddings(skills).catch(async (err) => {
    await log(`Failed to pre-compute skill embeddings: ${err}`);
  });

  return {
    "chat.message": async (input, output) => {
      const sessionID = output.message.sessionID;
      const agentName = output.message.agent;
      const isFirstMessage = !setupCompleteSessions.has(sessionID);

      if (isFirstMessage) {
        try {
          const existing = await client.session.messages({
            path: { id: sessionID },
          });

          if (existing.data) {
            const hasSkillsContent = existing.data.some(msg => {
              const parts = (msg as any).parts || (msg.info as any).parts;
              if (!parts) return false;
              return parts.some((part: any) =>
                part.type === 'text' && part.text?.includes('<available-skills>')
              );
            });

            if (hasSkillsContent) {
              setupCompleteSessions.add(sessionID);
            }
          }
        } catch {
        }
      }

      const permissions = await getPermissionsForAgent(agentName);

      if (!setupCompleteSessions.has(sessionID)) {
        setupCompleteSessions.add(sessionID);

        const context: SessionContext = {
          model: output.message.model,
          agent: agentName,
        };

        await maybeInjectSuperpowersBootstrap(projectDir, client, sessionID, context);
        await injectSkillsList(projectDir, client, sessionID, context, permissions);

        return;
      }

      const userText = output.parts
        .flatMap(part =>
          part.type === "text" && typeof part.text === "string" && !part.synthetic
            ? [part.text]
            : []
        )
        .join("\n")
        .trim();

      if (!userText) {
        return;
      }

      const skills = await getSkillSummaries(projectDir, permissions);
      if (skills.length === 0) {
        return;
      }

      const matchedSkills = await matchSkills(userText, skills);

      const loadedSkills = getLoadedSkills(sessionID);
      const newSkills = matchedSkills.filter(s => !loadedSkills.has(s.name));

      if (newSkills.length === 0) {
        return;
      }

      const injectionText = formatMatchedSkillsInjection(newSkills);

      const context: SessionContext = {
        model: output.message.model,
        agent: agentName,
      };

      await injectSyntheticContent(client, sessionID, injectionText, context);
    },

    event: async ({ event }) => {
      if (event.type === "session.compacted") {
        const sessionID = event.properties.sessionID;
        const context = await getSessionContext(client, sessionID);
        const permissions = await getPermissionsForAgent(context?.agent);
        await maybeInjectSuperpowersBootstrap(projectDir, client, sessionID, context);
        await injectSkillsList(projectDir, client, sessionID, context, permissions);
        loadedSkillsPerSession.delete(sessionID);
      }

      if (event.type === "session.deleted") {
        const sessionID = event.properties.info.id;
        setupCompleteSessions.delete(sessionID);
        loadedSkillsPerSession.delete(sessionID);
      }
    },

    tool: {
      get_available_skills: GetAvailableSkills(projectDir, client, getPermissionsForAgent),
      read_skill_file: ReadSkillFile(projectDir, client, getPermissionsForAgent),
      run_skill_script: RunSkillScript(projectDir, $, client, getPermissionsForAgent),
      use_skill: UseSkill(projectDir, client, getPermissionsForAgent, (sessionID, skillName) => {
        getLoadedSkills(sessionID).add(skillName);
      }),
    },
  };
};
