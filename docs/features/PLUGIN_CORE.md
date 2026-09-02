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
   - Loads strip patterns from `opencode.json`
   - Discovers all skills once and caches the global-filtered list as `baseSkills`
   - Precomputes embeddings (async, non-blocking)
   - Prunes legacy un-versioned `.bin` cache files (async, non-blocking)
   - Returns event handlers and tool definitions

2. **First Message** (`chat.message` handler)
   - Checks if session was previously set up (resume heuristic — looks for any prior `<available-skills>` or `<agent-switch-notice>` injection in session messages)
   - Resolves permissions for current agent (cached per agent via `getPermissionsForAgent`)
   - Injects `<available-skills>` list
   - Optionally injects superpowers bootstrap
   - Marks session as setup-complete

3. **Agent Change Detection** (`chat.message` handler)
   - Compares current agent with last known agent
   - If changed: injects `<agent-switch-notice>` and re-injects skills list
   - Clears loaded skills tracking for the session
   - Note: `loadedSkillsPerSession` is cleared but `setupCompleteSessions` is NOT — the session was already set up, only the agent context changed.

4. **Subsequent Messages** (`chat.message` handler)
   - Extracts user text from non-synthetic message parts
   - Resolves the agent-filtered skill list via `getSkillsForAgent` (in-memory filter of the cached `baseSkills`, no disk I/O)
   - Strips system-injected blocks from the user text via `stripText(userText, stripPatterns)`
   - Skips matching if the stripped text is < 20 chars (likely a short acknowledgment)
   - Runs `matchSkills(cleanText, skills)` — threshold + margin + topK filter
   - Drops matches whose skills were already loaded in this session (dedup via `loadedSkillsPerSession`)
   - Injects a `<relevant-skills>` block for the remaining matches via `injectSyntheticContent`
   - Whole block is wrapped in try/catch; errors are logged but do not break the chat.message handler (DPP-006)

5. **Compaction** (`session.compacted` event)
   - Re-injects superpowers bootstrap
   - Re-injects available skills list
   - Clears loaded skills tracking

6. **Deletion** (`session.deleted` event)
   - Removes session from all tracking maps (`setupCompleteSessions`, `loadedSkillsPerSession`, `currentAgentPerSession`)

## State Machine

```
[Plugin Load]
    |
    v
[Session Created] --(first message)--> [Skills Injected]
    |                                        |
    |                                        v
    |                              [User Message] --(strip + match)--> [Relevant Skills Injected?]
    |                                        |                                |
    |                                        |<------- (no match) <------------+
    |                                        v
    |                              [Agent Changed] --> [Switch Notice + Re-inject Skills]
    |                                        |
    v                                        v
[Session Compacted] <-------------------- [Skills Re-injected]
    |
    v
[Session Deleted] --> [Cleanup State]
```

Per-message `<relevant-skills>` injection runs on every non-first message when (a) the user text is long enough, (b) `matchSkills` returns at least one match, and (c) at least one of those matches wasn't already loaded in this session. The transition "(strip + match) → [Relevant Skills Injected]" fires zero, one, or multiple times per message.

## Invariants

- **INV-001:** Every session receives the skills list at most once per agent, unless compaction or agent change occurs.
- **INV-002:** The `<available-skills>` and `<relevant-skills>` blocks are always injected with `noReply: true` and `synthetic: true`. Both begin with a leading content line marking the content as synthetic system context (see `src/skills.ts` `injectSkillsList` and `src/plugin.ts` `formatRelevantSkillsInjection`).
- **INV-003:** Agent changes always trigger a re-injection of the skills list with a switch notice.
- **INV-004:** The plugin never throws during event handling; all errors are caught and logged.
- **INV-005:** Skill discovery (`getSkillSummaries`) runs at most once per agent over the plugin's lifetime. The per-message handler resolves its skill list via the cached `baseSkills` filtered in-memory by the agent's permissions (`getSkillsForAgent`). This keeps the per-message hot path off disk I/O.
- **INV-006:** The per-message `<relevant-skills>` block uses `TIER_CUTOFF` (imported from `src/embeddings.ts`) to label matches as `high` or `possible`. Matches within `TIER_CUTOFF` of the top score are `high`; otherwise `possible`.
- **INV-007:** `<relevant-skills>`, `<available-skills>`, `<available-subagents>`, and `<agent-switch-notice>` are in `DEFAULT_STRIP_PATTERNS` so pasted transcripts of plugin output cannot pollute the matcher query.

## Dependencies

### This Subsystem Depends On

- `src/skills.ts` — for skill discovery, summary construction, and permission filtering
- `src/permissions.ts` — for permission resolution and per-agent caching
- `src/embeddings.ts` — for `precomputeSkillEmbeddings`, `matchSkills`, `pruneLegacyEmbeddingCache`, and `TIER_CUTOFF`
- `src/strip-patterns.ts` — for `loadStripPatterns`, `stripText`, and `containsSystemBlock`
- `src/superpowers.ts` — for optional superpowers injection
- `src/utils.ts` — for session context and synthetic injection
- `src/logger.ts` — for debug logging
- `@opencode-ai/plugin` — for plugin framework types

### Other Subsystems Depending On This

- None (this is the top-level orchestrator)

## Constraints

- **Performance:** Plugin initialization must complete within 1 second (discovery, precompute, and prune are async and non-blocking). Per-message matching must complete well under the user's perceived LLM latency budget — the per-agent skill-list cache keeps the hot path off disk I/O.
- **Reliability:** Must not crash OpenCode on any error; all exceptions caught and logged.
- **Compatibility:** Must work with OpenCode v1.0.110 or later.
