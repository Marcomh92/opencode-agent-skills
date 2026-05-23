# MY_README.md - Personal Fork Documentation

## Fork Information
- **Original Repository:** https://github.com/joshuadavidthomas/opencode-agent-skills
- **Fork URL:** https://github.com/Marcomh92/opencode-agent-skills
- **Fork Date:** 2026-05-23
- **Fork Reason:** Fix bug where project-level skills (`.opencode/skills/`) were not discovered due to using `directory` instead of `worktree` from OpenCode's PluginInput API.

## Compilation Instructions
- **Build System Detected:** Bun / TypeScript (no explicit build step; loaded directly as TS)
- **Package Manager:** Bun
- **Prerequisites:** Bun >= 1.0.0
- **Install Command:** `bun install`
- **Typecheck Command:** `bun run typecheck`
- **Test Command:** `bun test`

## Development Notes
- Single plugin file: `src/plugin.ts`
- Plugin is loaded directly by OpenCode via Bun (no compilation to JS needed)
- Local override path: `.opencode/plugins/opencode-agent-skills.ts`
- Canonical name: `opencode-agent-skills`

## Build Verification
- **Initial Build Date:** 2026-05-23
- **Build Status:** N/A (TypeScript source loaded directly)
- **Typecheck Status:** Passed (after fix)

## Test Results (Original Project)
- **Test Execution Date:** 2026-05-23
- **Test Status:** ALL PASSED
- **Tests Run:** 51
- **Test Files:** 2 (embeddings.test.ts, utils.test.ts)
- **Expect Calls:** 456
- **Failed Tests:** None
- **Notes:** Tests executed with `bun test` v1.3.14. All 51 tests passed across both files.
