# Superpowers Bootstrap

## Purpose

The Superpowers Bootstrap subsystem provides optional automatic injection of the `using-superpowers` skill content when the Superpowers workflow is enabled. This allows users of the Superpowers project to get the full prompt automatically on session start.

## Boundaries

### In Scope

- Detecting superpowers mode via environment variable
- Discovering the `using-superpowers` skill
- Injecting skill content with tool mapping and namespace priority
- Re-injection after session compaction

### Out of Scope

- Installing or configuring the Superpowers project itself
- Modifying Superpowers skill content
- General superpowers workflow behavior (managed by the skill itself)

## High-Level Flow

1. **Mode Detection** (`src/superpowers.ts`, `maybeInjectSuperpowersBootstrap`)
   - Checks `OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE` environment variable
   - Only proceeds if value is exactly `"true"`

2. **Skill Discovery**
   - Searches for `using-superpowers` skill among all discovered skills
   - Skill may come from Claude plugin or OpenCode plugin installation

3. **Content Injection**
   - Wraps skill template in `<EXTREMELY_IMPORTANT>` tags
   - Appends OpenCode tool mapping instructions
   - Appends skill namespace priority documentation
   - Injects via synthetic message

4. **Compaction Re-injection**
   - Plugin Core calls `maybeInjectSuperpowersBootstrap` on `session.compacted`
   - Ensures superpowers content survives context compaction

## Environment Variable

| Variable | Values | Default |
|----------|--------|---------|
| `OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE` | `"true"` to enable, anything else to disable | `undefined` (disabled) |

## Tool Mapping

The following mapping is injected to help Claude-written Superpowers skills work in OpenCode:

| Claude Code Tool | OpenCode Equivalent |
|------------------|---------------------|
| `TodoWrite` / `TodoRead` | `todowrite` / `todoread` |
| `Task` (subagents) | `task` with `subagent_type` |
| `Skill` tool | `use_skill` |
| `Read` / `Write` / `Edit` / `Bash` / `Glob` / `Grep` / `WebFetch` | lowercase equivalents |

## Skill Namespace Priority

Injects documentation about skill namespace resolution order:

1. `project:skill-name`
2. `claude-project:skill-name`
3. `skill-name` (user-level)
4. `claude-user:skill-name`
5. `claude-plugins:skill-name`

First discovered match wins.

## External Contracts

### Inputs

| Source | Data | Trigger |
|--------|------|---------|
| Environment | `OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE` | Plugin startup, compaction |
| Skill Discovery | `using-superpowers` skill content | If skill exists and mode is enabled |

### Outputs

| Destination | Data | Trigger |
|-------------|------|---------|
| Session context | Superpowers skill content + tool mapping | Session start, compaction |

## Invariants

- **INV-001:** Superpowers injection only occurs when the environment variable is explicitly set to `"true"`.
- **INV-002:** If the `using-superpowers` skill is not found, injection is silently skipped.
- **INV-003:** Superpowers content is always injected as a synthetic message.
- **INV-004:** The injected content explicitly tells the AI not to call `use_skill` for `using-superpowers` since it is already loaded.

## Dependencies

### This Subsystem Depends On

- `src/skills.ts` — for skill discovery
- `src/utils.ts` — for synthetic content injection and session context

### Other Subsystems Depending On This

- `src/plugin.ts` — calls `maybeInjectSuperpowersBootstrap` on session start and compaction

## Constraints

- **Optional:** Superpowers support is completely optional. The plugin works fully without it.
- **External dependency:** Requires the Superpowers project to be installed separately.
- **Non-invasive:** Does not modify or depend on Superpowers internals.
