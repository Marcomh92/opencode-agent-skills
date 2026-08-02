# Skill Discovery

## Purpose

The Skill Discovery subsystem finds, validates, and indexes skills from multiple locations on the file system. It supports skills written for both OpenCode and Claude Code, enabling users to reuse existing skill libraries.

## Boundaries

### In Scope

- Recursive scanning of skill directories
- Parsing and validation of `SKILL.md` frontmatter
- Script discovery (finding executable files within skill directories)
- Namespace resolution (`project:skill-name`, `user:skill-name`, etc.)
- File listing within skill directories

### Out of Scope

- Skill content execution (handled by `src/tools.ts`)
- Permission filtering (handled by `src/permissions.ts`)
- Semantic matching (handled by `src/embeddings.ts`)
- Skill authoring or editing

## High-Level Flow

1. **Discovery Initiation** (`src/skills.ts`, `discoverAllSkills`)
   - Receives project directory path
   - Builds ordered list of discovery paths

2. **Directory Scanning** (`findSkillsRecursive`)
   - Scans each directory recursively up to max depth
   - Looks for `SKILL.md` in each subdirectory
   - Returns labeled discovery results

3. **Claude Plugin Discovery** (`src/claude.ts`)
   - Scans Claude plugin cache and marketplace directories
   - Supports both v1 and v2 plugin manifest formats
   - Returns labeled discovery results

4. **Skill Parsing** (`parseSkillFile`)
   - Reads `SKILL.md` content
   - Extracts YAML frontmatter
   - Validates against Zod schema (`SkillFrontmatterSchema`)
   - Discovers executable scripts in skill directory

5. **Deduplication**
   - First-found-wins strategy
   - Duplicate names are logged and skipped
   - No shadowing or merging

6. **Skill Resolution** (`resolveSkill`)
   - Looks up skill by name
   - Supports namespace prefix disambiguation
   - Returns full skill metadata

## Discovery Order

Skills are discovered from the following locations in priority order:

| Priority | Location | Label | Max Depth |
|----------|----------|-------|-----------|
| 1 | `.opencode/skills/` (project) | `project` | 3 |
| 2 | `.claude/skills/` (project) | `claude-project` | 1 |
| 3 | `~/.config/opencode/skills/` (user) | `user` | 3 |
| 4 | `~/.claude/skills/` (user) | `claude-user` | 1 |
| 5 | `~/.claude/plugins/cache/` | `claude-plugins` | Dynamic |
| 6 | `~/.claude/plugins/marketplaces/` | `claude-plugins` | Dynamic |

**Rule:** OpenCode paths take precedence over Claude paths at each level (project, user).

## Data Model

| Entity | Purpose | Source |
|--------|---------|--------|
| `Skill` | Complete skill metadata including path, scripts, template | `src/skills.ts` |
| `SkillSummary` | Lightweight name + description for preflight evaluation | `src/skills.ts` |
| `SkillLabel` | Source location enum | `src/skills.ts` |
| `Script` | Executable script metadata (relative + absolute paths) | `src/skills.ts` |

## External Contracts

### Inputs

| Source | Data | Trigger |
|--------|------|---------|
| File system | `SKILL.md` files with YAML frontmatter | Plugin initialization or tool call |
| File system | Executable scripts in skill directories | Skill parsing |
| Claude Code | `installed_plugins.json` manifest | Claude plugin discovery |

### Outputs

| Destination | Data | Trigger |
|-------------|------|---------|
| Plugin Core | `Map<string, Skill>` | Discovery completion |
| Plugin Core | `SkillSummary[]` | Preflight evaluation |
| Tools | Skill metadata + content | Tool execution |

## Invariants

- **INV-001:** Skill names must be unique across all discovery sources. Duplicates are skipped (first wins).
- **INV-002:** Skill names must match `^[\p{Ll}\p{N}-]+$` (lowercase alphanumeric with hyphens).
- **INV-003:** Skill discovery is read-only. No files are modified during discovery.
- **INV-004:** Script discovery skips hidden directories, dependency directories (`node_modules`, `__pycache__`, etc.), and non-executable files.

## Dependencies

### This Subsystem Depends On

- `src/utils.ts` — for file discovery and YAML parsing
- `src/claude.ts` — for Claude plugin discovery
- `src/logger.ts` — for debug logging

### Other Subsystems Depending On This

- `src/plugin.ts` — initiates discovery on plugin load
- `src/tools.ts` — calls discovery on every tool execution
- `src/embeddings.ts` — receives skill summaries for precomputation

## Constraints

- **Performance:** Discovery should complete within 500ms for typical skill collections.
- **Depth limits:** OpenCode skills scan 3 levels deep; Claude skills scan 1 level deep.
- **Script safety:** Only files with executable bit set are exposed as scripts.
