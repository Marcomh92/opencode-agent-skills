# Architecture

## Component Overview

| Component | Responsibility | Source File |
|-----------|---------------|-------------|
| Plugin Core | Session lifecycle, event handling, tool registration | `src/plugin.ts` |
| Tools | Tool factory functions with permission-aware execution | `src/tools.ts` |
| Skill Discovery | Multi-source skill scanning and validation | `src/skills.ts` |
| Permissions | Per-agent skill access control | `src/permissions.ts` |
| Embeddings | Semantic similarity for automatic skill matching | `src/embeddings.ts` |
| Claude Compat | Claude Code plugin and skills discovery | `src/claude.ts` |
| Superpowers | Optional Superpowers skill bootstrap injection | `src/superpowers.ts` |
| Utilities | Shared helpers (file ops, fuzzy matching, injection) | `src/utils.ts` |
| Logger | Debug logging to file | `src/logger.ts` |

## Data Flow

1. **Plugin initialization** (`src/plugin.ts`)
   - Loads global permissions
   - Discovers all available skills
   - Precomputes skill embeddings (async, non-blocking)
   - Registers 4 tools with OpenCode

2. **Session start** (`chat.message` event, first message)
   - Checks if skills list already injected (session resume)
   - Resolves permissions for current agent
   - Injects `<available-skills>` list via synthetic message
   - Optionally injects superpowers bootstrap

3. **Subsequent messages** (`chat.message` event)
   - Detects agent changes and re-injects skills list with notice
   - Runs per-message semantic matching: strip system blocks from user text → embed → cosine-similarity match → threshold + margin + topK filter → dedup against already-loaded skills → inject a `<relevant-skills>` block with relevance tiers (`high` / `possible`) for any remaining matches. Default ON, no env-var gate. See `docs/features/SEMANTIC_MATCHING.md` and `docs/features/PLUGIN_CORE.md` INV-005–INV-007 for the full contract.

4. **Tool execution** (`tool.*` handlers)
   - Validates permissions before skill access
   - Resolves skill by name (supports namespace prefixes)
   - Loads skill content or executes scripts
   - Injects results via synthetic messages

5. **Compaction** (`session.compacted` event)
   - Re-injects available skills list
   - Re-injects superpowers bootstrap
   - Clears loaded skills tracking

6. **Session deletion** (`session.deleted` event)
   - Cleans up session tracking state

## Communication Rules

| From | To | Allowed? | Rule |
|------|-----|----------|------|
| Plugin Core | Tools | Yes | Direct function call with injected dependencies |
| Plugin Core | Skill Discovery | Yes | Direct import |
| Plugin Core | Permissions | Yes | Direct import |
| Plugin Core | Embeddings | Yes | Direct import |
| Tools | Utilities | Yes | Direct import |
| Tools | Permissions | Yes | Direct import |
| Skill Discovery | Utilities | Yes | Direct import |
| Claude Compat | Skill Discovery | Yes | Direct import (types) |
| Any component | Logger | Yes | Direct import |

## External Integrations

| System | Purpose | Integration Point |
|--------|---------|-------------------|
| OpenCode Plugin API | Plugin framework, session management, tool registration | `@opencode-ai/plugin` package |
| Hugging Face Transformers | Text embedding generation for semantic matching | `@huggingface/transformers` package |
| File System | Skill discovery, script execution, logging | `node:fs/promises`, `node:path` |
| Claude Code Ecosystem | Skill and plugin compatibility | `~/.claude/plugins/`, `~/.claude/skills/` |

## State Management

The plugin maintains three per-session maps:

| Map | Key | Value | Purpose |
|-----|-----|-------|---------|
| `setupCompleteSessions` | `sessionID` | `boolean` | Tracks whether initial skills list was injected |
| `loadedSkillsPerSession` | `sessionID` | `Set<string>` | Tracks which skills have been loaded (to avoid re-suggesting already-loaded skills) |
| `currentAgentPerSession` | `sessionID` | `string` | Tracks current agent to detect agent switches |

Plus two plugin-level caches:

| Cache | Key | Value | Purpose |
|-------|-----|-------|---------|
| `permissionsCache` | `agentName` | `AgentPermissions` | Avoids repeated file reads for permission resolution |
| `skillsCache` | `agentName` (or `"__global__"`) | `SkillSummary[]` | Per-agent permission-filtered skill list. Discovery runs once at startup (`baseSkills`); each agent's filtered view is resolved lazily and cached. Keeps the per-message hot path off disk I/O. |

## Key Decisions

- [ADR-001: Anthropic Skills Spec](DECISIONS/001-why-anthropic-skills-spec.md) — Why we standardize on the Anthropic Agent Skills Spec
- [ADR-002: Custom Permission Key](DECISIONS/002-why-custom-permission-key.md) — Why we avoid OpenCode's native `skill` permission key
- [ADR-003: Synthetic Injection](DECISIONS/003-why-synthetic-injection.md) — Why we use synthetic messages instead of tool return values for skill content
