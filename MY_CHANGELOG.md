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
