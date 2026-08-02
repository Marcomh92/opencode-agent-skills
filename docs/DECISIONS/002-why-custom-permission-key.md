# ADR 002: Custom Permission Key

## Status

Accepted

## Context

OpenCode has a native `skill` permission system. This plugin also needs to control skill access. Using the same permission key would cause conflicts:
- OpenCode's native system might interpret our rules differently
- Users with existing `skill` permissions would get unexpected behavior
- The two systems have different semantics (OpenCode native may not support glob patterns)

Alternatives considered:
1. **Use OpenCode's native `skill` key** — Reuse existing permission infrastructure
2. **Custom key `opencode-agent-skills`** — Isolate our permission system
3. **No permissions** — Allow all skills unconditionally

## Decision

We will use a custom permission key `opencode-agent-skills` instead of OpenCode's native `skill` key.

This creates a separate namespace for plugin-specific permissions without interfering with OpenCode's built-in behavior.

## Consequences

### Positive
- No conflict with OpenCode's native skill permission system
- Users can use both systems independently
- Full control over permission semantics (glob patterns, `ask` action)
- Can evolve independently of OpenCode's permission schema

### Negative
- Users must learn a separate permission key
- Permissions are not visible in OpenCode's native permission UI
- Two systems to configure for skill access control

### Neutral
- The custom key is namespaced to this plugin, avoiding collisions with other plugins

## Compliance

All permission configs must use the key `opencode-agent-skills`. The plugin ignores the native `skill` key.

Example config:
```json
{
  "permission": {
    "opencode-agent-skills": {
      "*": "allow",
      "admin-*": "deny"
    }
  }
}
```

## Notes

This decision may be revisited if OpenCode's native permission system gains feature parity with our requirements (glob patterns, per-agent rules, `ask` action).
