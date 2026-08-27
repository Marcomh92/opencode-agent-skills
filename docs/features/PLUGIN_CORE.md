# Plugin Core

## Purpose

The Plugin Core is the main entry point and lifecycle manager for the opencode-agent-skills plugin. It registers with the OpenCode plugin framework, handles session events, manages per-session state, and wires together all subsystems (tools, skill discovery, permissions, embeddings, superpowers).

## Boundaries

### In Scope

- Plugin initialization and tool registration
- Session lifecycle management (start, compaction, deletion)
- Agent change detection and skill list re-injection
- Synthetic content injection orchestration
- Integration of all subsystems (tools, discovery, permissions, embeddings)

### Out of Scope

- Skill content parsing (handled by `src/skills.ts`)
- Permission rule evaluation (handled by `src/permissions.ts`)
- Embedding computation (handled by `src/embeddings.ts`)
- Claude-specific discovery (handled by `src/claude.ts`)
- Superpowers content generation (handled by `src/superpowers.ts`)

## High-Level Flow

1. **Plugin Load** (`src/plugin.ts`, `SkillsPlugin` function)
   - Clears debug log
   - Loads global permissions from `opencode.json`
   - Discovers all skills (async, non-blocking)
   - Precomputes embeddings (async, non-blocking)
   - Returns event handlers and tool definitions

2. **First Message** (`chat.message` handler)
   - Checks if session was previously set up (resumes)
   - Resolves permissions for current agent
   - Injects `<available-skills>` list
   - Optionally injects superpowers bootstrap
   - Marks session as setup-complete

3. **Agent Change Detection** (`chat.message` handler)
   - Compares current agent with last known agent
   - If changed: injects `<agent-switch-notice>` and re-injects skills list
   - Clears loaded skills tracking for the session

4. **Subsequent Messages** (`chat.message` handler)
   - Extracts user text from message parts
   - Per-message `<skill-evaluation-required>` injection is currently **disabled** (see Invariants and Constraints); the `chat.message` handler returns early without invoking semantic matching or building an injection block. `formatMatchedSkillsInjection` and the original call site are preserved in `src/plugin.ts` for re-enablement.

5. **Compaction** (`session.compacted` event)
   - Re-injects superpowers bootstrap
   - Re-injects available skills list
   - Clears loaded skills tracking

6. **Deletion** (`session.deleted` event)
   - Removes session from all tracking maps

## State Machine

```
[Plugin Load]
    |
    v
[Session Created] --(first message)--> [Skills Injected]
    |                                        |
    |                                        v
    |                              [User Messages] (no per-message injection)
    |                                        |
    |                                        v
    |                              [Agent Changed] --> [Re-inject Skills]
    |                                        |
    v                                        v
[Session Compacted] <-------------------- [Skills Re-injected]
    |
    v
[Session Deleted] --> [Cleanup State]
```

Per-message `<skill-evaluation-required>` injection is disabled (see INV-005); the transition "(match) → [Evaluation Prompt]" no longer fires during normal operation.

## Invariants

- **INV-001:** Every session receives the skills list at most once per agent, unless compaction or agent change occurs.
- **INV-002:** The `<available-skills>` block is always injected with `noReply: true` and `synthetic: true`. The block now begins with a leading content line marking the content as synthetic system context (see `src/skills.ts` `injectSkillsList`).
- **INV-003:** Agent changes always trigger a re-injection of the skills list with a switch notice.
- **INV-004:** The plugin never throws during event handling; all errors are caught and logged.
- **INV-005:** Per-message `<skill-evaluation-required>` injection is disabled. `formatMatchedSkillsInjection` and the original call site are preserved in `src/plugin.ts` so the injection can be restored without re-architecting; the semantic matching subsystem (`src/embeddings.ts`) remains in use only for the startup precomputation path.

## Dependencies

### This Subsystem Depends On

- `src/skills.ts` — for skill discovery and list injection
- `src/permissions.ts` — for permission resolution
- `src/embeddings.ts` — for semantic matching
- `src/superpowers.ts` — for optional superpowers injection
- `src/utils.ts` — for session context and synthetic injection
- `src/logger.ts` — for debug logging
- `@opencode-ai/plugin` — for plugin framework types

### Other Subsystems Depending On This

- None (this is the top-level orchestrator)

## Constraints

- **Performance:** Plugin initialization must complete within 1 second (discovery is async and non-blocking).
- **Reliability:** Must not crash OpenCode on any error; all exceptions caught and logged.
- **Compatibility:** Must work with OpenCode v1.0.110 or later.
