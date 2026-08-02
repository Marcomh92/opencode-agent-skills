# Claude Compatibility

## Purpose

The Claude Compatibility subsystem enables the plugin to discover and use skills and plugins written for Claude Code. This includes skills from `.claude/skills/`, Claude marketplace plugins, and cached plugin skills.

## Boundaries

### In Scope

- Discovery of Claude Code skills from `.claude/skills/` directories
- Discovery of skills from Claude marketplace plugins
- Discovery of skills from Claude plugin cache
- Support for both v1 and v2 plugin manifest formats
- Tool translation injection for Claude-written skills

### Out of Scope

- Converting Claude Code tools to OpenCode tools (handled by tool translation instructions)
- Installing or managing Claude plugins
- Claude-specific runtime behavior

## High-Level Flow

1. **Claude Skill Discovery** (`src/skills.ts`, `discoverAllSkills`)
   - Includes `.claude/skills/` paths in discovery order
   - Scans at depth 1 (Claude skills are flat)
   - Labels discovered skills as `claude-project` or `claude-user`

2. **Marketplace Plugin Discovery** (`src/claude.ts`, `discoverMarketplaceSkills`)
   - Reads `~/.claude/plugins/installed_plugins.json`
   - Supports v1 format: `plugins[name] = { installPath }`
   - Supports v2 format: `plugins[name] = [{ scope, installPath, ... }]`
   - For v2: uses `installPath` directly to find skills
   - For v1: reads marketplace manifest to resolve skill paths
   - Labels discovered skills as `claude-plugins`

3. **Plugin Cache Discovery** (`src/claude.ts`, `discoverPluginCacheSkills`)
   - Scans `~/.claude/plugins/cache/`
   - Supports old v1 structure: `cache/plugin-name/skills/skill-name/SKILL.md`
   - Supports new v2 structure: `cache/marketplace/plugin/version/skills/skill-name/SKILL.md`
   - Serves as fallback when `installed_plugins.json` is unavailable
   - Labels discovered skills as `claude-plugins`

4. **Tool Translation** (`src/claude.ts`, `toolTranslation`)
   - Injected into every loaded skill's content
   - Maps Claude Code tool names to OpenCode equivalents
   - Helps Claude-written skills work correctly in OpenCode

## Discovery Order

Claude skills are discovered after OpenCode skills at each level:

| Priority | Location | Label |
|----------|----------|-------|
| 2 | `.claude/skills/` (project) | `claude-project` |
| 4 | `~/.claude/skills/` (user) | `claude-user` |
| 5 | `~/.claude/plugins/cache/` | `claude-plugins` |
| 6 | `~/.claude/plugins/marketplaces/` | `claude-plugins` |

## Plugin Manifest Formats

### v1 Format
```json
{
  "version": 1,
  "plugins": {
    "plugin-name@marketplace": {
      "installPath": "/path/to/plugin"
    }
  }
}
```

### v2 Format
```json
{
  "version": 2,
  "plugins": {
    "plugin-name": [
      {
        "scope": "user",
        "installPath": "/path/to/plugin",
        "version": "1.0.0"
      }
    ]
  }
}
```

## Tool Translation Mapping

| Claude Code Tool | OpenCode Equivalent |
|------------------|---------------------|
| `TodoWrite` / `TodoRead` | `todowrite` / `todoread` |
| `Task` (subagents) | `task` with `subagent_type` |
| `Skill` tool | `use_skill` |
| `Read` / `Write` / `Edit` | `read` / `write` / `edit` |
| `Bash` | `bash` |
| `Glob` / `Grep` | `glob` / `grep` |
| `WebFetch` | `webfetch` |

## External Contracts

### Inputs

| Source | Data | Trigger |
|--------|------|---------|
| File system | `.claude/skills/` directories | Plugin startup |
| File system | `installed_plugins.json` | Plugin startup |
| File system | Marketplace manifests | Plugin startup (v1 only) |
| File system | Plugin cache directories | Plugin startup (fallback) |

### Outputs

| Destination | Data | Trigger |
|-------------|------|---------|
| Skill Discovery | `LabeledDiscoveryResult[]` | Discovery completion |
| Tools | Tool translation instructions | Every skill load |

## Invariants

- **INV-001:** Claude skills are always labeled with `claude-*` prefixes.
- **INV-002:** OpenCode skills take precedence over Claude skills at the same level (project, user).
- **INV-003:** Tool translation is always injected into loaded Claude skills.
- **INV-004:** Both v1 and v2 plugin manifest formats are supported.

## Dependencies

### This Subsystem Depends On

- `src/utils.ts` — for file discovery
- `src/skills.ts` — for `LabeledDiscoveryResult` type and `findFile`

### Other Subsystems Depending On This

- `src/skills.ts` — calls `discoverMarketplaceSkills` and `discoverPluginCacheSkills`
- `src/tools.ts` — injects `toolTranslation` into loaded skills

## Constraints

- **Compatibility:** Must support both current and legacy Claude Code directory structures.
- **Robustness:** Must handle missing or malformed manifest files gracefully.
- **Performance:** Marketplace discovery reads JSON files; no network calls.
