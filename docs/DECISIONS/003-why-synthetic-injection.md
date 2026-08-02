# ADR 003: Synthetic Message Injection

## Status

Accepted

## Context

Skills need to be loaded into the AI agent's context so it can follow their instructions. Two approaches were possible:

1. **Tool return value** — Return skill content as the tool execution result
2. **Synthetic message injection** — Inject skill content as a system-generated message into the conversation context

Alternatives considered:
1. **Return in tool response** — Simple, but content is ephemeral (lost on compaction)
2. **Synthetic injection with `noReply` + `synthetic`** — Persistent across compaction, invisible to user
3. **File system watcher** — Auto-load skills without user action (too aggressive)

## Decision

We will use synthetic message injection (`noReply: true`, `synthetic: true`) to load skills into context.

This makes skill content part of the persistent conversation context that survives OpenCode's context compaction mechanism.

## Consequences

### Positive
- Skill content persists across long sessions
- Invisible to users (not shown in UI, not counted as user input)
- Agent doesn't reply to the injection itself (no wasted turns)
- Works with OpenCode's compaction model

### Negative
- Increases token usage (skill content is in context)
- Requires careful context management (must pass model/agent to prevent switching)
- More complex than simple tool return values
- Potential for context bloat if many skills are loaded

### Neutral
- Plugin also injects a skills list on session start (same mechanism)
- Compaction events trigger re-injection to maintain availability

## Compliance

All skill content injection must:
1. Use `client.session.prompt()` with `noReply: true`
2. Mark parts as `synthetic: true`
3. Pass current `model` and `agent` context
4. Be wrapped in semantic XML tags (`<skill>`, `<available-skills>`, etc.)

## Notes

The `noReply` flag prevents the agent from generating a response to the injection. The `synthetic` flag hides the message from the user interface.

Context passing (model + agent) is critical: without it, OpenCode may switch to a different model or agent mode after the injection.
