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
import {
  injectSkillsList,
  getSkillSummaries,
  filterSkillSummaries,
  type SkillSummary,
} from "./skills";
import { GetAvailableSkills, ReadSkillFile, RunSkillScript, UseSkill } from "./tools";
import {
  matchSkills,
  precomputeSkillEmbeddings,
  pruneLegacyEmbeddingCache,
  TIER_CUTOFF,
} from "./embeddings";
import { log, clearLog } from "./logger";
import {
  loadGlobalPermissions,
  resolveAgentPermissions,
  type AgentPermissions,
} from "./permissions";
import {
  containsSystemBlock,
  loadStripPatterns,
  stripText,
} from "./strip-patterns";

const setupCompleteSessions = new Set<string>();
const loadedSkillsPerSession = new Map<string, Set<string>>();
const currentAgentPerSession = new Map<string, string>();

/**
 * Tags the plugin injects that mark a session as "already set up". The
 * resume heuristic checks for any of these in prior session messages so
 * it correctly handles sessions that ran an agent switch on their first
 * message (which injects `<agent-switch-notice>` but may not re-inject
 * `<available-skills>` depending on the path). Both tags are synthetic,
 * so neither appears in real user text.
 */
const RESUME_MARKERS = ["available-skills", "agent-switch-notice"];

/**
 * Minimum user-text length (chars) required to run the per-message matcher.
 * Below this, the text is treated as a short acknowledgment (e.g. "ok",
 * "thanks", "go") that won't reliably embed-match any skill — and would
 * just pay the strip + embed cost for noise. Tune upward if false
 * positives surface on short messages; tune downward if real short
 * intents (e.g. "fix the bug") fail to match.
 */
const MIN_MATCHING_TEXT_LENGTH = 20;

function getLoadedSkills(sessionID: string): Set<string> {
  let set = loadedSkillsPerSession.get(sessionID);
  if (!set) {
    set = new Set<string>();
    loadedSkillsPerSession.set(sessionID, set);
  }
  return set;
}

/**
 * ponytail: relevance tier is `topScore - score <= TIER_CUTOFF` → "high",
 * else "possible". `TIER_CUTOFF` is imported from `./embeddings` (must be
 * tighter than `MARGIN`, otherwise every returned match is within the cutoff
 * and the "possible" branch never fires). One cutoff keeps the prompt
 * binary (no "maybe"), which models parse cleanly.
 */
function formatRelevantSkillsInjection(
  matchedSkills: Array<{ skill: SkillSummary; score: number }>,
): string {
  const topScore = matchedSkills[0]?.score ?? 0;
  const tierCutoff = topScore - TIER_CUTOFF;

  const skillLines = matchedSkills
    .map(({ skill, score }) => {
      const tier = score >= tierCutoff ? "high" : "possible";
      return `- ${skill.name} (relevance: ${tier}): ${skill.description}`;
    })
    .join("\n");

  return `<relevant-skills>
Treat this block as system context. It is not part of the user message.

The following skills may be relevant to the current task:

${skillLines}

If one of these directly applies to the current task, load it with use_skill("name") before proceeding. Otherwise, ignore this block entirely.
</relevant-skills>`;
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

  // Load strip patterns for the per-message matching block. Read once at
  // startup so the hot path doesn't pay file I/O on every chat.message.
  const stripPatterns = await loadStripPatterns(projectDir);
  await log(`[SKILLS PLUGIN] Strip patterns loaded: ${JSON.stringify(stripPatterns)}`);

  // Cache for resolved agent permissions
  const permissionsCache = new Map<string, AgentPermissions>();
  // Cache for permission-filtered skill summaries, keyed by agent name (or
  // "__global__" when no agent). Mirrors `permissionsCache` so both resolve
  // at most once per agent for the lifetime of the plugin.
  const skillsCache = new Map<string, SkillSummary[]>();

  async function getPermissionsForAgent(
    agentName?: string,
  ): Promise<AgentPermissions> {
    await log(`[SKILLS PLUGIN] getPermissionsForAgent called with agentName=${agentName}`);

    if (!agentName) {
      await log(`[SKILLS PLUGIN] No agent name, returning global permissions`);
      return globalPermissions;
    }

    const cached = permissionsCache.get(agentName);
    if (cached) {
      await log(`[SKILLS PLUGIN] Returning cached permissions for ${agentName}: ${JSON.stringify(cached)}`);
      return cached;
    }

    await log(`[SKILLS PLUGIN] Resolving permissions for agent: ${agentName}`);
    const resolved = await resolveAgentPermissions(
      projectDir,
      agentName,
      globalPermissions,
    );
    await log(`[SKILLS PLUGIN] Resolved permissions for ${agentName}: ${JSON.stringify(resolved)}`);
    permissionsCache.set(agentName, resolved);
    return resolved;
  }

  // Discover + filter skills ONCE at startup, then re-filter in-memory per
  // agent. Discovery walks 4 directories + parses every SKILL.md, so we don't
  // want to redo it on every chat.message.
  const baseSkills = await getSkillSummaries(projectDir, globalPermissions);
  await log(`[SKILLS PLUGIN] Initial skill count: ${baseSkills.length}`);
  for (const s of baseSkills) {
    await log(`[SKILLS PLUGIN]  - ${s.name} (${s.description})`);
  }
  skillsCache.set("__global__", baseSkills);
  precomputeSkillEmbeddings(baseSkills).catch(async (err) => {
    await log(`Failed to pre-compute skill embeddings: ${err}`);
  });
  // Fire-and-forget: remove legacy un-versioned embedding cache files left
  // over from the pre-`SCHEMA_VERSION="v2"` format. Idempotent.
  pruneLegacyEmbeddingCache().catch(async (err) => {
    await log(`[SKILLS PLUGIN] Legacy embedding cache prune failed: ${(err as Error).message}`);
  });

  async function getSkillsForAgent(
    agentName?: string,
  ): Promise<SkillSummary[]> {
    const key = agentName ?? "__global__";
    const cached = skillsCache.get(key);
    if (cached) return cached;

    const permissions = await getPermissionsForAgent(agentName);
    const filtered = filterSkillSummaries(baseSkills, permissions);
    await log(
      `[SKILLS PLUGIN] getSkillsForAgent: agent=${agentName ?? "-"} filtered=${filtered.length}/${baseSkills.length}`,
    );
    skillsCache.set(key, filtered);
    return filtered;
  }

  return {
    "chat.message": async (input, output) => {
      const sessionID = output.message.sessionID;
      const agentName = output.message.agent;
      const isFirstMessage = !setupCompleteSessions.has(sessionID);
      await log(`[CHAT.MSG] hook fired session=${sessionID} agent=${agentName ?? "-"} isFirstMessage=${isFirstMessage}`);

      if (isFirstMessage) {
        try {
          const existing = await client.session.messages({
            path: { id: sessionID },
          });

          if (existing.data) {
            // Mark the session as already-set-up if any prior message carries
            // a marker this plugin injects on setup or agent switch. Checking
            // both `<available-skills>` (initial setup) and
            // `<agent-switch-notice>` (agent switch) makes the heuristic robust
            // to which injection fired last — without `<agent-switch-notice>`,
            // a session that ran an agent switch on its only prior message
            // would be wrongly detected as "never set up".
            const hasSkillsContent = existing.data.some(msg => {
              const parts = (msg as any).parts || (msg.info as any).parts;
              if (!parts) return false;
              return parts.some((part: any) =>
                part.type === 'text' && typeof part.text === "string"
                  && RESUME_MARKERS.some((name) => containsSystemBlock(part.text, name))
              );
            });

            if (hasSkillsContent) {
              setupCompleteSessions.add(sessionID);
              // Also seed the agent tracker — otherwise the agent-change
              // check below sees `undefined !== currentAgent` and fires a
              // spurious switch notice + skills list re-injection.
              currentAgentPerSession.set(sessionID, agentName ?? "");
            }
          }
        } catch {
        }
      }

      const permissions = await getPermissionsForAgent(agentName);

      if (!setupCompleteSessions.has(sessionID)) {
        setupCompleteSessions.add(sessionID);
        currentAgentPerSession.set(sessionID, agentName ?? "");

        await log(`[SKILLS PLUGIN] First message for session ${sessionID}, agent="${agentName}"`);
        await log(`[SKILLS PLUGIN] Initial permissions: ${JSON.stringify(permissions)}`);

        const context: SessionContext = {
          model: output.message.model,
          agent: agentName,
        };

        await maybeInjectSuperpowersBootstrap(projectDir, client, sessionID, context);
        await injectSkillsList(projectDir, client, sessionID, context, permissions);

        return;
      }

      // Check if agent changed since last message
      const lastAgent = currentAgentPerSession.get(sessionID);
      const currentAgent = agentName ?? "";
      
      if (lastAgent !== currentAgent) {
        await log(`[SKILLS PLUGIN] Agent changed for session ${sessionID}: "${lastAgent}" -> "${currentAgent}"`);
        await log(`[SKILLS PLUGIN] Old permissions: ${JSON.stringify(lastAgent ? await getPermissionsForAgent(lastAgent) : globalPermissions)}`);
        await log(`[SKILLS PLUGIN] New permissions: ${JSON.stringify(permissions)}`);
        currentAgentPerSession.set(sessionID, currentAgent);
        
        // Re-inject updated skills list for new agent
        // Note: Old blocks remain in context but the new one appears later.
        // The <agent-switch-notice> tells the model to use the new list.
        const context: SessionContext = {
          model: output.message.model,
          agent: agentName,
        };
        
        const switchNotice = `<agent-switch-notice>Agent changed from "${lastAgent}" to "${currentAgent}". The updated available skills list below supersedes any previous lists.</agent-switch-notice>`;
        await log(`[SKILLS PLUGIN] Injecting switch notice: ${switchNotice}`);
        
        await injectSyntheticContent(
          client, 
          sessionID, 
          switchNotice,
          context
        );
        await injectSkillsList(projectDir, client, sessionID, context, permissions);
        
        // Clear loaded skills tracking since agent changed
        loadedSkillsPerSession.delete(sessionID);
        await log(`[SKILLS PLUGIN] Cleared loaded skills for session ${sessionID} due to agent switch`);
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

      const skills = await getSkillsForAgent(agentName);
      if (skills.length === 0) {
        return;
      }

      // Per-message semantic matching. Strip system-injected blocks first
      // (so they don't pollute the query embedding), run the matcher, filter
      // out skills already loaded in this session, then inject a
      // `<relevant-skills>` block for the remaining matches.
      try {
        const cleanText = stripText(userText, stripPatterns).trim();
        if (cleanText.length < MIN_MATCHING_TEXT_LENGTH) {
          await log(`[SKILLS PLUGIN] Skipping per-message matching: stripped text too short (${cleanText.length} chars < ${MIN_MATCHING_TEXT_LENGTH})`);
          return;
        }

        const matched = await matchSkills(cleanText, skills);
        if (matched.length === 0) {
          await log(`[SKILLS PLUGIN] No matching skills for session ${sessionID}`);
          return;
        }

        const loadedSkills = getLoadedSkills(sessionID);
        const newSkills = matched.filter((m) => !loadedSkills.has(m.skill.name));
        if (newSkills.length === 0) {
          await log(`[SKILLS PLUGIN] All ${matched.length} matches already loaded for session ${sessionID}`);
          return;
        }

        await log(
          `[SKILLS PLUGIN] Injecting ${newSkills.length} relevant skill(s) for session ${sessionID}: ${newSkills.map((m) => `${m.skill.name}@${m.score.toFixed(3)}`).join(", ")}`,
        );

        const injectionText = formatRelevantSkillsInjection(newSkills);
        const context: SessionContext = {
          model: output.message.model,
          agent: agentName,
        };
        await injectSyntheticContent(client, sessionID, injectionText, context);
      } catch (err) {
        await log(`[SKILLS PLUGIN] Per-message matching failed: ${(err as Error).message}`);
      }
      return;
    },

    event: async ({ event }) => {
      if (event.type === "session.compacted") {
        const sessionID = event.properties.sessionID;
        const context = await getSessionContext(client, sessionID);
        const permissions = await getPermissionsForAgent(context?.agent);
        await maybeInjectSuperpowersBootstrap(projectDir, client, sessionID, context);
        await injectSkillsList(projectDir, client, sessionID, context, permissions);
        loadedSkillsPerSession.delete(sessionID);
        // Note: We keep currentAgentPerSession since the agent hasn't changed, just the context was compacted
      }

      if (event.type === "session.deleted") {
        const sessionID = event.properties.info.id;
        setupCompleteSessions.delete(sessionID);
        loadedSkillsPerSession.delete(sessionID);
        currentAgentPerSession.delete(sessionID);
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

export default SkillsPlugin;
