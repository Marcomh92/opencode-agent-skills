# Performance

## Response Time Budgets

| Operation | Target | Measurement |
|-----------|--------|-------------|
| Skill discovery (cached) | < 100ms | First call per tool execution |
| Skill discovery (cold) | < 500ms | Initial plugin load |
| Semantic matching | < 2s | Per user message (includes embedding generation) |
| Tool execution | < 100ms | Excluding script execution time |
| Script execution | User-dependent | Delegated to shell |

## Throughput Targets

| Resource | Target |
|----------|--------|
| Concurrent skill discoveries | Unlimited (read-only, no locks) |
| Embedding cache hits | Near-instant (disk read) |
| Embedding cache misses | 1-2s (model inference) |

## Resource Limits

| Resource | Limit | Action on Exceed |
|----------|-------|------------------|
| Embedding model memory | ~100 MB (quantized) | Loaded once, shared across calls |
| Embedding cache size | Unbounded (disk-based) | Manual cleanup if needed |
| Skill discovery depth | 3 levels (OpenCode), 1 level (Claude) | Hard limit to prevent deep recursion |
| Script execution depth | 10 levels | Hard limit in `findScripts` |

## Caching Strategy

| Cache Layer | Key | TTL | Invalidation |
|-------------|-----|-----|--------------|
| Embedding vectors | SHA256 of text | Persistent (disk) | Never (manual delete) |
| Permissions | Agent name | Session lifetime | Cleared on plugin reload |
| Skill discovery | None | Per-call | N/A (read-only discovery) |

## Optimization Principles

- Embed model is loaded lazily on first semantic match request
- Embeddings are precomputed at plugin startup (non-blocking)
- Skill discovery results are not cached; re-discovered on each tool call to pick up new skills
- Permission resolution is cached per agent to avoid repeated file reads

## Load Testing

- No automated load tests (plugin is client-side, single-user)
- Performance is validated through embedding test suite timing
