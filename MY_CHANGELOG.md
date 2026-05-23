# MY_CHANGELOG.md - Personal Change History

## Format
Each entry must include:
- Date
- Branch name
- Summary of changes
- Reason for changes
- Files modified

---

## 2026-05-23 - Initial Fork
- **Branch:** main
- **Changes:** Forked repository from joshuadavidthomas/opencode-agent-skills
- **Reason:** Starting personal copy to fix project-level skill discovery bug

## 2026-05-23 - Fix Project-Level Skill Discovery
- **Branch:** fix/project-skill-discovery
- **Changes:** 
  - Destructured `worktree` from `PluginInput` in `src/plugin.ts`
  - Added `projectDir = worktree ?? directory` fallback
  - Replaced all uses of `directory` with `projectDir` for skill discovery functions
- **Reason:** Plugin was using `directory` (plugin installation dir) instead of `worktree` (project working dir) to resolve `.opencode/skills/` paths, causing project-level skills to never be discovered
- **Files:** `src/plugin.ts`

## 2026-05-23 - Add File-Based Logging Infrastructure
- **Branch:** fix/project-skill-discovery
- **Changes:**
  - Created `src/logger.ts` with persistent file-based logging to `debug.log`
  - Instrumented `src/plugin.ts` with startup logging (directory, worktree, projectDir, skill counts)
  - Instrumented `src/skills.ts` with discovery logging (paths, directory existence, results, parse failures)
  - Instrumented `src/tools.ts` with tool invocation logging
- **Reason:** Console errors in plugin context are ephemeral and hard to capture. File-based logging was essential to trace the exact failure point in skill discovery and parsing.
- **Files:** `src/logger.ts`, `src/plugin.ts`, `src/skills.ts`, `src/tools.ts`

## 2026-05-23 - Fix CRLF Frontmatter Parsing (Primary Root Cause)
- **Branch:** fix/project-skill-discovery
- **Changes:**
  - Updated frontmatter regex in `parseSkillFile()` from `/^---\n/` to `/^---\r?\n/`
  - Changed all `\n` in regex to `\r?\n` to support both LF and CRLF line endings
- **Reason:** After adding logging, discovered that project-level skills WERE being discovered (10 found) but all failed to parse. Byte-level inspection revealed SKILL.md files started with `---\r\n` (CRLF). The regex only matched `---\n` (LF), causing `frontmatterMatch` to be null and skills to be silently discarded. This was the actual root cause — the worktree fix exposed this second bug.
- **Files:** `src/skills.ts`

## 2026-05-23 - Verification: CRLF Was Sole Root Cause
- **Branch:** fix/project-skill-discovery
- **Changes:**
  - Reverted worktree fix to test if it was necessary
  - Confirmed skills still loaded with `const projectDir = directory`
  - Restored worktree fix as defensive coding
- **Reason:** OpenCode passes the same project directory for both `directory` and `worktree` when loading via `file://` URL. The worktree fix is theoretically correct but not triggered in this environment. The CRLF fix alone resolves the issue.
- **Files:** `src/plugin.ts`

## 2026-05-23 - Implement Per-Agent Skill Permissions
- **Branch:** feature/per-agent-skill-permissions
- **Changes:**
  - Created `src/permissions.ts` with permission parsing, merging, and evaluation logic
  - Implemented custom permission key `opencode-agent-skills` to avoid conflict with OpenCode's native `skill` permission
  - Added `loadGlobalPermissions()` to parse permissions from `opencode.json` (project and user-level)
  - Added `loadAgentPermissions()` to parse per-agent permissions from agent markdown frontmatter
  - Added `mergePermissions()` with last-write-wins semantics matching OpenCode
  - Added `evaluateSkillPermission()` with wildcard pattern matching
  - Modified `src/skills.ts` to filter skills by permissions in `getSkillSummaries()` and `injectSkillsList()`
  - Modified `src/tools.ts` to check permissions before executing any tool (`get_available_skills`, `read_skill_file`, `run_skill_script`, `use_skill`)
  - Modified `src/plugin.ts` to load global permissions at startup, cache agent permissions, and pass them through all integration points
  - Created `src/permissions.test.ts` with 34 unit tests for permission evaluation
- **Reason:** User requested per-agent skill permissions similar to OpenCode's native permission system. This allows global skill permissions in `opencode.json` with per-agent overrides in agent markdown files. The custom permission key was necessary because OpenCode's native `skill` permission must be set to `deny` to disable the native skill system and rely solely on our plugin.
- **Files:** `src/permissions.ts`, `src/permissions.test.ts`, `src/plugin.ts`, `src/skills.ts`, `src/tools.ts`

## 2026-05-23 - Fix Agent Discovery for Global Agent Directory
- **Branch:** feature/per-agent-skill-permissions
- **Changes:**
  - Fixed `loadAgentPermissions()` to search in both project-level (`.opencode/agent/`) and global-level (`~/.config/opencode/agent/`) directories
  - Added comprehensive logging to `loadGlobalPermissions()`, `loadAgentPermissions()`, and `resolveAgentPermissions()`
  - Added logging to skill filtering in `src/skills.ts` and all tool executions in `src/tools.ts`
  - Fixed async filter callbacks to use for...of loops instead (TypeScript error)
- **Reason:** Initial permission implementation failed because agent files (like `exploration.md`) are stored in the global `~/.config/opencode/agent/` directory, but the plugin only searched in the project's `.opencode/agent/` directory. The added logging was necessary to diagnose this silent failure.
- **Files:** `src/permissions.ts`, `src/skills.ts`, `src/tools.ts`, `src/plugin.ts`

## 2026-05-23 - Handle Agent Switching with Permission Re-evaluation
- **Branch:** feature/per-agent-skill-permissions
- **Changes:**
  - Added `currentAgentPerSession` Map to track the last known agent for each session
  - Modified `chat.message` handler to detect agent changes mid-session
  - When agent changes, inject an `<agent-switch-notice>` message followed by updated `<available-skills>` with new agent's permissions
  - Clear `loadedSkillsPerSession` when agent changes to reset skill loading state
  - Clean up `currentAgentPerSession` on session deletion
- **Reason:** The `<available-skills>` block was only injected once per session during setup. When switching agents (e.g., from exploration to build-orchestrator), the old agent's skills list remained in context while the new agent might have different permissions. This caused incorrect skill availability - denied skills from the old agent could still appear available, or allowed skills for the new agent might be missing.
- **Files:** `src/plugin.ts`

## 2026-05-23 - Add Detailed Injection Logging
- **Branch:** feature/per-agent-skill-permissions
- **Changes:**
  - `injectSkillsList()` now logs the complete injected `<available-skills>` block including session ID and all skills
  - Agent switch detection logs old permissions vs new permissions
  - Initial session setup logs the agent name and permissions being applied
  - Switch notice message is logged before injection
  - Loaded skills clearing is logged on agent switch
- **Reason:** User requested full visibility into what blocks are being injected and what permissions are active. This is essential for debugging permission filtering and verifying agent switching works correctly.
- **Files:** `src/skills.ts`, `src/plugin.ts`
