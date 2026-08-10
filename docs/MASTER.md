# opencode-agent-skills

> A dynamic skills plugin for OpenCode that provides tools for loading and using reusable AI agent skills with semantic matching, permission control, and Claude Code compatibility.

## System Boundaries

This plugin provides skill discovery, loading, and management capabilities for OpenCode. It does not implement the AI agent itself, the OpenCode runtime, or skill content authoring tools. It operates within the OpenCode plugin framework and extends the agent's capabilities through synthetic context injection and tool registration.

## Tech Stack

| Technology | Purpose | Version |
|------------|---------|---------|
| Bun | Runtime and package manager | >= 1.0.0 |
| TypeScript | Primary language | 5.9.3 (strict mode) |
| Zod | Runtime validation schemas | 4.1.13 |
| @opencode-ai/plugin | Plugin framework | 1.0.115 |
| @huggingface/transformers | Semantic skill matching (embeddings) | 3.8.1 |
| YAML | Frontmatter parsing | 2.8.2 |

## Directory Structure

| Directory | Purpose |
|-----------|---------|
| `src/` | Source code (single-file plugin + modules) |
| `src/plugin.ts` | Main plugin entry point |
| `src/tools.ts` | Tool factory functions (4 tools) |
| `src/skills.ts` | Skill discovery and management |
| `src/permissions.ts` | Permission system |
| `src/embeddings.ts` | Semantic matching via embeddings |
| `src/claude.ts` | Claude Code compatibility layer |
| `src/superpowers.ts` | Superpowers bootstrap injection |
| `src/utils.ts` | Shared utilities |
| `src/logger.ts` | Debug logging |
| `docs/` | Project documentation |

## Documentation Index

### Project-Level Documents

- [Design Principles](DESIGN_PRINCIPLES.md) — Core architectural rules and rationale
- [Architecture](ARCHITECTURE.md) — Component responsibilities and data flow
- [Patterns](PATTERNS.md) — Common code patterns and conventions
- [Testing](TESTING.md) — Testing philosophy and responsibilities
- [Performance](PERFORMANCE.md) — Optimization guidelines and budgets

### Architecture Decisions

- [ADR-001: Anthropic Skills Spec](DECISIONS/001-why-anthropic-skills-spec.md) — Why we adopt the Anthropic Agent Skills Spec
- [ADR-002: Custom Permission Key](DECISIONS/002-why-custom-permission-key.md) — Why we use a custom permission key instead of OpenCode's native skill permission
- [ADR-003: Synthetic Injection](DECISIONS/003-why-synthetic-injection.md) — Why we use synthetic message injection for skill persistence

### Feature-Level Documents

- [Plugin Core](features/PLUGIN_CORE.md) — Main plugin lifecycle, session management, and tool registration
- [Skill Discovery](features/SKILL_DISCOVERY.md) — Multi-source skill discovery and validation
- [Semantic Matching](features/SEMANTIC_MATCHING.md) — Automatic skill suggestion via embeddings
- [Permissions](features/PERMISSIONS.md) — Per-agent skill access control
- [Claude Compatibility](features/CLAUDE_COMPATIBILITY.md) — Claude Code skills and plugin support
- [Superpowers Bootstrap](features/SUPERPOWERS_BOOTSTRAP.md) — Automatic Superpowers skill injection

## Glossary

| Term | Definition |
|------|------------|
| **Skill** | A reusable unit of AI agent behavior, packaged as a directory containing `SKILL.md` with YAML frontmatter and optional supporting files/scripts |
| **Synthetic injection** | Injecting content into the conversation context via `noReply` + `synthetic` messages, making it persistent but invisible to the user |
| **Skill label** | Source identifier for a skill: `project`, `user`, `claude-project`, `claude-user`, or `claude-plugins` |
| **Embedding** | A numerical vector representation of text, used to compute semantic similarity between user messages and skill descriptions |
| **Permission rule** | A glob pattern paired with an action (`allow`, `deny`, `ask`) that controls whether an agent may use a skill |
| **Superpowers mode** | Optional mode that auto-injects the `using-superpowers` skill content on session start |
| **Compaction resilience** | The property of re-injecting skills after OpenCode's context compaction event to maintain availability across long sessions |
| **`OPENCODE_AGENT_SKILLS_LOG_FILE`** | Optional environment variable that overrides the default debug log path (`~/.config/opencode/opencode-agent-skills/debug.log`). Set to an empty string to use the default. See PAT-008. |
