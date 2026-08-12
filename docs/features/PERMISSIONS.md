# Permissions

## Purpose

The Permissions subsystem controls which skills each AI agent is allowed to access. It implements per-agent skill permissions using a custom permission key to avoid conflict with OpenCode's native skill permission system.

## Boundaries

### In Scope

- Global permission loading from `opencode.json`
- Agent-specific permission loading from agent markdown files
- Permission rule parsing (string and object formats)
- Permission merging (global + agent-specific)
- Glob pattern matching for skill names
- Skill access evaluation (`allow`, `deny`, `ask`)

### Out of Scope

- OpenCode's native `skill` permission handling
- UI for permission configuration
- Permission persistence (managed by user via config files)

## High-Level Flow

1. **Global Permission Loading** (`src/permissions.ts`, `loadGlobalPermissions`)
   - Searches `opencode.json` in project directory (`./.opencode/opencode.json`)
   - Falls back to user-level config (`~/.config/opencode/opencode.json`)
   - Extracts permissions under custom key `opencode-agent-skills`
   - Returns default `allow all` if no config found

2. **Agent Permission Loading** (`loadAgentPermissions`)
   - Searches agent markdown files in `./.opencode/agents/` and `./.opencode/agent/`
   - Also searches `~/.config/opencode/agents/` and `~/.config/opencode/agent/`
   - Matches agent by `name` frontmatter field or filename
   - Extracts permissions from agent frontmatter

3. **Permission Resolution** (`resolveAgentPermissions`)
   - Loads agent permissions
   - Merges with global permissions (agent overrides global for same patterns)
   - Caches result per agent name

4. **Skill Access Check** (`isSkillAllowed`, `evaluateSkillPermission`)
   - Iterates rules in **config order**; first matching rule wins (no specificity sort)
   - For tag patterns (`tag:capability:*` / `tag:audience:*` / `tag:maturity:*`), matches against the skill's frontmatter `metadata`; metadata-less skills default to `audience: "all"` + `maturity: "stable"` (no `capability` default — a `tag:capability:*` rule against a metadata-less skill falls through, no false allow)
   - Unrecognised tag kinds (e.g. `tag:priority:high`) fall through to the next rule (lenient matcher per `07-tag-skills/skill-permissions.md:193`)
   - `isSkillAllowed` returns `true` for `allow` and `ask`, `false` for `deny`

## Permission Rule Format

Rules support two formats in JSON config:

### Shorthand String
```json
{
  "permission": {
    "opencode-agent-skills": "allow"
  }
}
```

### Object with Patterns
```json
{
  "permission": {
    "opencode-agent-skills": {
      "*": "deny",
      "git-*": "allow",
      "dangerous-skill": "ask"
    }
  }
}
```

### Agent Markdown Frontmatter
```markdown
---
name: my-agent
permission:
  opencode-agent-skills:
    "*": "allow"
    "admin-*": "deny"
---
```

## Pattern Matching

Patterns use glob syntax with `*` wildcard:

| Pattern | Matches | Does Not Match |
|---------|---------|----------------|
| `*` | Any skill name | None |
| `git-*` | `git-helper`, `git-status` | `my-git`, `pdf` |
| `*-helper` | `git-helper`, `pdf-helper` | `helper-git` |
| `exact-name` | `exact-name`, `Exact-Name` | `exact-name-2` |
| `tag:capability:<value>` | skills whose `metadata.capability === <value>` | anything else |
| `tag:audience:<value>` | skills whose `metadata.audience === <value>` (or metadata-less skills, which default to `audience: "all"`) | anything else |
| `tag:maturity:<value>` | skills whose `metadata.maturity === <value>` (or metadata-less skills, which default to `maturity: "stable"`) | anything else |

Matching is case-insensitive. Special regex characters in glob patterns are escaped.

Tag patterns are matched against the skill's frontmatter `metadata`, not against `skillName`. Unrecognised tag kinds (e.g. `tag:priority:high`) fall through to the next rule (lenient matcher per `07-tag-skills/skill-permissions.md:193`). Metadata-less skills default `audience` to `"all"` and `maturity` to `"stable"` (`07-tag-skills/tag-schema.md:100`); `capability` has no default, so a `tag:capability:*` rule against a metadata-less skill falls through to the next rule (no false allow).

## Permission Resolution Order

For rule ordering within a single agent's config:

1. Default: `allow all` (when no rule matches)
2. Rules iterate in **config order**, first match wins (`07-tag-skills/skill-permissions.md:46`). The matcher does NOT sort by specificity — putting a wildcard before a specific pattern means the wildcard wins.

For loading order between config sources:

1. Default: `allow all`
2. Global config (`opencode.json`)
3. Agent markdown frontmatter

Later overrides earlier for the same pattern.

## Data Model

| Entity | Purpose | Source |
|--------|---------|--------|
| `AgentPermissions` | Complete permission configuration for an agent | `src/permissions.ts` |
| `PermissionRule` | Single pattern-action pair | `src/permissions.ts` |
| `PermissionAction` | `"allow"`, `"deny"`, or `"ask"` | `src/permissions.ts` |

## External Contracts

### Inputs

| Source | Data | Trigger |
|--------|------|---------|
| File system | `opencode.json` | Plugin startup |
| File system | Agent markdown files (`*.md`) | First message from agent |

### Outputs

| Destination | Data | Trigger |
|-------------|------|---------|
| Plugin Core | `AgentPermissions` | Agent context resolution |
| Tools | `boolean` (is allowed) | Tool execution permission check |

## Invariants

- **INV-001:** The custom permission key is `opencode-agent-skills`, never `skill`.
- **INV-002:** Empty permission list defaults to `allow`.
- **INV-003:** No matching pattern defaults to `allow`.
- **INV-004:** Rules iterate in **config order**; first match wins. There is no specificity sort — a wildcard listed before a specific pattern means the wildcard wins.
- **INV-005:** Agent permissions override global permissions for the same pattern.
- **INV-006 (Phase 2 WS2.3):** Tag patterns (`tag:capability:*` / `tag:audience:*` / `tag:maturity:*`) match against the skill's frontmatter `metadata`. Metadata-less skills default to `audience: "all"` + `maturity: "stable"` (`07-tag-skills/tag-schema.md:100` migration promise); `capability` has no default, so a `tag:capability:*` rule against a metadata-less skill falls through to the next rule. Unrecognised tag kinds fall through (lenient matcher per `07-tag-skills/skill-permissions.md:193`).

## Dependencies

### This Subsystem Depends On

- `src/utils.ts` — for YAML frontmatter parsing
- `src/logger.ts` — for debug logging

### Other Subsystems Depending On This

- `src/plugin.ts` — loads global permissions at startup, resolves per-agent permissions
- `src/tools.ts` — checks permissions before every skill access

## Constraints

- **Security:** Permission configs are user-controlled. The plugin only reads them.
- **Performance:** Agent permissions are cached to avoid repeated file reads.
- **Compatibility:** Uses custom key to avoid conflicting with OpenCode's native permission system.
