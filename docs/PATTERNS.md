# Patterns

This document defines common code patterns, idioms, and conventions used consistently across the opencode-agent-skills codebase.

## PAT-001: Factory Functions for Tools

**Pattern:** Each tool is created by a factory function that accepts dependencies (`directory`, `client`, `getPermissions`) and returns a tool object.

**When to use:** All 4 plugin tools (`use_skill`, `read_skill_file`, `run_skill_script`, `get_available_skills`).

**When not to use:** Internal utility functions that do not need plugin context.

**Source:** `src/tools.ts`

**Rationale:** Dependency injection enables testing with mock clients and permissions. Keeps tool logic separate from plugin wiring.

## PAT-002: Silent Catch for Optional Operations

**Pattern:** Use empty `catch` blocks for operations that are truly optional and should not break the user experience if they fail.

**When to use:** File reads for optional configs, cache operations, logging failures, skill discovery in optional directories.

**When not to use:** Core functionality like skill loading, permission checks, or script execution where failure has user-facing consequences.

**Source:** `src/skills.ts` (optional directory discovery), `src/logger.ts` (log write failures)

**Rationale:** The plugin must function even when optional files are missing or permissions prevent access. Per [AGENTS.md](../AGENTS.md): "silent catches OK for optional operations."

## PAT-003: TypeScript `noUncheckedIndexedAccess`

**Pattern:** Always check array/object access results before use. Use non-null assertion (`!`) only when the value is guaranteed to exist.

**When to use:** All array iterations, Map lookups, object property access.

**When not to use:** When the compiler can prove the value exists (e.g., inside a length check).

**Source:** `tsconfig.json`, `src/embeddings.ts` (vector element access), `src/utils.ts` (Levenshtein DP table)

**Rationale:** Prevents runtime undefined values from propagating. Enforced by `tsconfig.json`.

## PAT-004: Zod Schema Validation

**Pattern:** Use Zod schemas for runtime validation of external data (YAML frontmatter, JSON configs).

**When to use:** Skill frontmatter parsing, permission config parsing, any data from user-controlled files.

**When not to use:** Internal data structures that are created and consumed within the same module.

**Source:** `src/skills.ts` (`SkillFrontmatterSchema`), `src/permissions.ts` (`SkillPermissionConfigSchema`)

**Rationale:** Runtime validation catches malformed user input early. Zod provides TypeScript inference from schemas.

## PAT-005: Namespace-Prefixed Skill Resolution

**Pattern:** Support `namespace:skill-name` syntax for disambiguating skills from different sources.

**When to use:** Tool arguments that accept skill names (`use_skill`, `read_skill_file`, `run_skill_script`).

**When not to use:** Internal skill storage or discovery (uses raw names).

**Source:** `src/skills.ts` (`resolveSkill`)

**Rationale:** Users may have skills with the same name in project and user directories. Namespaces provide deterministic selection.

## PAT-006: Fuzzy Matching with Suggestion

**Pattern:** When a skill or script is not found, compute the closest match using combined scoring (prefix, substring, Levenshtein) and suggest it to the user.

**When to use:** All user-facing name lookups where typos are likely.

**When not to use:** Internal lookups where exact matching is required.

**Source:** `src/utils.ts` (`findClosestMatch`)

**Rationale:** Improves user experience by correcting typos instead of just reporting "not found."

## PAT-007: YAML Safe Parsing

**Pattern:** Parse YAML with `schema: "core"` and `maxAliasCount: 100` to prevent code execution and DoS.

**When to use:** All YAML frontmatter parsing in skill files.

**When not to use:** None. All YAML parsing must use safe options.

**Source:** `src/utils.ts` (`parseYamlFrontmatter`)

**Rationale:** Skills are user-authored and may come from untrusted sources. The core schema prevents custom tags that could execute code.

## PAT-008: Async Logging

**Pattern:** All logging is async (`Promise<void>`) and writes to a single debug log file.

**When to use:** All diagnostic logging in the plugin.

**When not to use:** None.

**Source:** `src/logger.ts`

**Rationale:** Avoids blocking the event loop. Failures are silently ignored to prevent logging errors from breaking functionality.
