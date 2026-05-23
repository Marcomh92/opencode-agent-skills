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
