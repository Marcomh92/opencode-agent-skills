# Design Principles

This document defines the non-negotiable rules that shape the opencode-agent-skills codebase. Every principle includes its rationale and enforcement mechanism.

## DPP-001: Single Plugin Entry Point

**Principle:** The plugin must export exactly one `Plugin` function from `src/plugin.ts`.

**Rationale:** OpenCode's plugin framework expects a single default export. Keeping all plugin logic in one entry point ensures compatibility and simplifies loading.

**Enforcement:** Verified by TypeScript compilation. The `SkillsPlugin` function is the sole export.

**Exception:** Supporting modules (`src/*.ts`) export utility functions for testing and internal use, but only `SkillsPlugin` is exposed to OpenCode.

## DPP-002: No Production Code in Tests

**Principle:** Test files (`*.test.ts`) must only import from source modules, never define production logic.

**Rationale:** Prevents test logic from leaking into production builds. Keeps the production bundle minimal.

**Enforcement:** Code review. No `*.test.ts` files are included in the `files` array in `package.json`.

**Exception:** None.

## DPP-003: Synthetic Content Must Preserve Session Context

**Principle:** All synthetic content injections must pass the current `model` and `agent` context to prevent OpenCode from switching modes or models.

**Rationale:** OpenCode uses the last message's model/agent to determine behavior for subsequent turns. Injecting without context can cause unwanted model switches or agent changes.

**Enforcement:** Verified by code review. All calls to `injectSyntheticContent` in `src/utils.ts` must receive a `SessionContext` object.

**Exception:** None.

## DPP-004: Path Safety for All File Operations

**Principle:** Any user-provided path that resolves to a file system location must be validated to prevent directory traversal.

**Rationale:** Skills may contain executable scripts. Allowing arbitrary path access would be a security vulnerability.

**Enforcement:** `isPathSafe` utility in `src/utils.ts` is used before all file reads. Architecture tests could enforce this.

**Exception:** None.

## DPP-005: Skill Discovery Is Read-Only

**Principle:** The plugin must never modify skill files or directories during discovery.

**Rationale:** Skills are user-authored content. The plugin is a consumer, not an editor. Modifying skills would violate user expectations and could corrupt skill content.

**Enforcement:** Code review. All file system operations in `src/skills.ts` and `src/claude.ts` use read-only APIs (`fs.readFile`, `fs.readdir`, `fs.stat`).

**Exception:** None.

## DPP-006: Graceful Degradation for Optional Features

**Principle:** Optional features (embeddings, permissions, superpowers) must fail gracefully without breaking core functionality.

**Rationale:** The plugin must work in diverse environments. Some users may not have GPU support for embeddings, may not configure permissions, or may not install superpowers.

**Enforcement:** Verified by tests and code review. All optional feature initializations are wrapped in try/catch blocks with silent fallbacks.

**Exception:** None.

## DPP-007: OpenCode-First, Claude-Compatible

**Principle:** OpenCode conventions take precedence over Claude Code conventions. Claude compatibility is additive, not primary.

**Rationale:** This is an OpenCode plugin. Claude compatibility enables skill reuse but must not compromise OpenCode-native behavior.

**Enforcement:** Discovery order in `discoverAllSkills` puts OpenCode paths before Claude paths at each level (project, user, plugins).

**Exception:** Tool translation instructions are injected into loaded skills to help Claude-written skills work in OpenCode.
