# ADR 001: Anthropic Agent Skills Spec

## Status

Accepted

## Context

The plugin needed a standardized format for skills. Without a standard, users would need to learn plugin-specific formats, and skill portability would be limited.

Alternatives considered:
1. **Custom format** — Define our own skill format with different frontmatter schema
2. **OpenCode native format** — Use OpenCode's built-in skill format (but this plugin predates native support)
3. **Anthropic Agent Skills Spec** — Adopt the emerging industry standard from Anthropic

## Decision

We will adopt the Anthropic Agent Skills Spec as the canonical skill format.

Skills are directories containing a `SKILL.md` file with YAML frontmatter specifying `name`, `description`, and optional `license`, `allowed-tools`, and `metadata`.

## Consequences

### Positive
- Skills are portable between Claude Code and OpenCode
- Users can reuse existing skill libraries
- Clear, documented standard reduces confusion
- Ecosystem compatibility: skills from marketplace plugins work out of the box

### Negative
- Limited to Anthropic's schema (cannot add custom frontmatter fields without risk)
- Must validate against their spec (version drift risk)
- Tool translation needed for skills written for Claude Code tools

### Neutral
- Skill authors already familiar with Claude Code need no relearning
- Plugin adds OpenCode-specific tool translation automatically

## Compliance

All skills discovered by the plugin must have valid `SKILL.md` with frontmatter matching the Anthropic spec. Invalid skills are skipped with a log message.

## Notes

See the spec at https://github.com/anthropics/skills/blob/main/agent_skills_spec.md

OpenCode has since added native skill support. This plugin remains in maintenance mode for users who depend on its additional behaviors (semantic matching, synthetic injection, etc.).
