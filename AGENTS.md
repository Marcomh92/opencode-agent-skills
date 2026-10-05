# Agent Guidelines

## Commands
- **Package manager:** Bun (not npm/yarn)
- **Test:** `bun test` or `just test`
- **Single test:** `bun test path/to/file.test.ts` or `bun test --grep "pattern"`
- **Typecheck:** `bun run typecheck` (runs `tsc --noEmit`)
- **Build:** `just build`

## Code Style
- **TypeScript strict mode** with `noUncheckedIndexedAccess` - always check array/object access
- **ES modules** - use `import`/`export`, no CommonJS
- **Node imports** - use `node:` prefix (e.g., `import * as fs from "node:fs/promises"`)
- **Zod** for runtime validation schemas
- **Naming:** camelCase for functions/variables, PascalCase for types/interfaces
- **JSDoc comments** (`/** */`) for public functions
- **Error handling:** try/catch with graceful fallbacks; silent catches OK for optional operations
- **Async/await** - prefer over raw promises
- **Path safety:** validate user paths don't escape base directories using `path.resolve`

## Project Structure
- Single plugin file at `src/plugin.ts`
- Plugin exports a single `Plugin` function that returns tools and event handlers

## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Git-friendly: Auto-syncs to JSONL for version control
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

**Check for ready work:**
```bash
bd ready --json
```

**Create new issues:**
```bash
bd create "Issue title" -t bug|feature|task -p 0-4 --json
bd create "Issue title" -p 1 --deps discovered-from:bd-123 --json
bd create "Subtask" --parent <epic-id> --json  # Hierarchical subtask (gets ID like epic-id.1)
```

**Claim and update:**
```bash
bd update bd-42 --status in_progress --json
bd update bd-42 --priority 1 --json
```

**Complete work:**
```bash
bd close bd-42 --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task**: `bd update <id> --status in_progress`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" -p 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`
6. **Commit together**: Always commit the `.beads/issues.jsonl` file together with the code changes so issue state stays in sync with code state

### Auto-Sync

bd automatically syncs with git:
- Exports to `.beads/issues.jsonl` after changes (5s debounce)
- Imports from JSONL when newer (e.g., after `git pull`)
- No manual export/import needed!

### GitHub Copilot Integration

If using GitHub Copilot, also create `.github/copilot-instructions.md` for automatic instruction loading.
Run `bd onboard` to get the content, or see step 2 of the onboard instructions.

### MCP Server (Recommended)

If using Claude or MCP-compatible clients, install the beads MCP server:

```bash
pip install beads-mcp
```

Add to MCP config (e.g., `~/.config/claude/config.json`):
```json
{
  "beads": {
    "command": "beads-mcp",
    "args": []
  }
}
```

Then use `mcp__beads__*` functions instead of CLI commands.

### Managing AI-Generated Planning Documents

AI assistants often create planning and design documents during development:
- PLAN.md, IMPLEMENTATION.md, ARCHITECTURE.md
- DESIGN.md, CODEBASE_SUMMARY.md, INTEGRATION_PLAN.md
- TESTING_GUIDE.md, TECHNICAL_DESIGN.md, and similar files

**Best Practice: Use a dedicated directory for these ephemeral files**

**Recommended approach:**
- Create a `history/` directory in the project root
- Store ALL AI-generated planning/design docs in `history/`
- Keep the repository root clean and focused on permanent project files
- Only access `history/` when explicitly asked to review past planning

**Example .gitignore entry (optional):**
```
# AI planning documents (ephemeral)
history/
```

**Benefits:**
- ✅ Clean repository root
- ✅ Clear separation between ephemeral and permanent documentation
- ✅ Easy to exclude from version control if desired
- ✅ Preserves planning history for archeological research
- ✅ Reduces noise when browsing the project

### CLI Help

Run `bd <command> --help` to see all available flags for any command.
For example: `bd create --help` shows `--parent`, `--deps`, `--assignee`, etc.

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ✅ Store AI planning docs in `history/` directory
- ✅ Run `bd <cmd> --help` to discover available flags
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems
- ❌ Do NOT clutter repo root with planning documents

## Bug Report Management

Bug reports live in `known_issues/`.

- **When fixing:** Check `known_issues/*.md`, read if found, mark **FIXED** with date after resolving, move to `known_issues/fixed/`
- **When creating:** Check `known_issues/` AND `known_issues/fixed/` for duplicates, use next `BUG-xxx` number, name: `BUG-xxx-short-description.md`

## GitNexus — Code Intelligence

GitNexus gives a structural view of the codebase: who calls what, what breaks on a change, and which files a rename must touch. It is a snapshot of the last `gitnexus analyze` — git remains ground truth for what changed on disk.

**`REPO` is this project's GitNexus repo name. Every `opencode-agent-skills` below means the value of `REPO`.** This project is indexed as `opencode-agent-skills`. All gitnexus_* MCP tools are invoked directly, **never** via the bash tool.

### Enabled Tools

| Tool | Use for |
| --- | --- |
| `gitnexus_impact` | Depth-ordered blast radius + risk grade before editing a shared symbol |
| `gitnexus_context` | Callers, callees, implements/extends for one symbol |
| `gitnexus_rename` | Graph-aware multi-file rename — always `dry_run: true` first |
| `gitnexus_detect_changes` | Changed symbols and impacted flows for a diff |
| `gitnexus_list_repos` | Discovering the repo name |

Not available: `gitnexus_query`, `gitnexus_cypher`, `gitnexus://` MCP resources.

### Always Do

- Resolve the symbol before analyzing it — `grep` for the name to get its real `file_path`. Users name the wrong class often enough that a name-only call returns a confident answer about the wrong symbol.
- Run `gitnexus_impact({target, file_path, direction: "upstream", summaryOnly: true, repo: "opencode-agent-skills"})` before editing any existing symbol — function, class, method, property, or constant — and report the risk grade to the user.
- Warn the user before editing when impact returns HIGH or CRITICAL.
- Run `gitnexus_detect_changes({scope: "all", repo: "opencode-agent-skills"})` before committing.
- Use `summaryOnly: true` on the first `impact` call for any symbol — a full dump on a hub symbol floods context.
- Treat an empty impact result as unproven, not safe. Zero d=1 records also means "not in the index" — cross-check with `grep`.
- `grep` for the old name after every rename — the graph cannot see string literals, comments, annotation values, or resource IDs.

### Never Do

- NEVER edit a symbol without first running `gitnexus_impact` on it.
- NEVER rename with find-and-replace — use `gitnexus_rename`.
- NEVER trust the graph for which files changed — `gitnexus_detect_changes` misses untracked files.
- NEVER invoke gitnexus_* MCP tools via the bash tool.

### Index Maintenance

Check freshness from the project root with `gitnexus status`. It compares the indexed commit against the current one and prints `Status: up-to-date` or marks it stale. If stale, rebuild with `gitnexus analyze`. These two commands are the only shell exceptions to the no-bash rule for gitnexus MCP tools.
