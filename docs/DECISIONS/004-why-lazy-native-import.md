# ADR 004: Lazy Native Import for Optional Embeddings

## Status

Accepted

## Context

`src/embeddings.ts` statically imported `@huggingface/transformers` at module scope. That package pulls in the native `onnxruntime-node` addon. OpenCode loads a plugin with a stage-1 `import()`; if that import throws — for example a transient failure loading the native addon — OpenCode reports the failure only to an internal event bus, never to a log file. The plugin's factory function never runs, so no tools register and the plugin vanishes silently with no debug log. This occurred in roughly 28% of sessions.

Alternatives considered:

1. **Keep the static import** — accept silent, total plugin loss on any native load failure
2. **Catch the import at module scope** — not possible; a static `import` cannot be wrapped in `try/catch`
3. **Load the native backend on first use** — chosen

## Decision

We will not import any native-backed dependency at module scope. `@huggingface/transformers` is imported through a memoized dynamic `import()` behind `loadTransformers()` in `src/embeddings.ts`, resolved at first use and wrapped so a load failure degrades semantic matching to a no-op instead of failing the plugin.

Importing `src/plugin.ts` must never load native code and must never throw at module scope.

## Consequences

### Positive

- Tool registration is independent of embeddings availability; all four tools register whenever the plugin loads.
- An embeddings failure is logged once (plugin logger + `console.error`) and contained; the plugin keeps working.
- Skill discovery and permissions are unaffected by a native load failure.

### Negative

- The load failure no longer surfaces at plugin-load time; the user learns about it only from the warning or by noticing missing suggestions.
- The first embedding request now also pays the module import cost (previously paid at plugin load).

### Neutral

- The load is attempted at most once per process and is not retried; recovery requires a process restart.
- `HF_ENDPOINT` is applied when the module resolves rather than eagerly.

## Compliance

- No native-backed package may be statically imported in a plugin entry module.
- `loadTransformers()` is the sole loader; it must memoize its promise and log at most one fallback warning.
- Importing `src/plugin.ts` must not load native code and must not throw at module scope (see DPP-006 and `docs/features/SEMANTIC_MATCHING.md` INV-008, INV-009).
- Enforced by the isolated-subprocess regression test in `src/embeddings.test.ts` (`src/embeddings-import-failure.fixture.ts`).

## Notes

OpenCode's stage-1 failure reporting is an upstream behavior and outside the plugin's control, so the plugin must not depend on it.
