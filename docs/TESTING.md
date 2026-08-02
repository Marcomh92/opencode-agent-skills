# Testing

## Philosophy

We follow a practical test pyramid focused on correctness of core algorithms and business logic:

- Many unit tests for algorithms (permissions, fuzzy matching, embeddings)
- Integration-level tests for cross-component behavior (skill matching)
- Minimal end-to-end tests (handled by manual OpenCode integration testing)

## Test Types

| Type | Responsibility | Target Coverage | Location |
|------|---------------|-----------------|----------|
| Unit | Individual functions and pure logic | Core algorithms | `src/*.test.ts` (colocated) |
| Integration | Cross-component interactions | Semantic matching | `src/embeddings.test.ts` |
| Manual | Plugin behavior in OpenCode runtime | Critical paths | Tested by running plugin in OpenCode |

## Test File Organization

Tests are colocated with source files:

| Source | Test File | Coverage |
|--------|-----------|----------|
| `src/permissions.ts` | `src/permissions.test.ts` | Pattern matching, permission merging, evaluation |
| `src/utils.ts` | `src/utils.test.ts` | Levenshtein distance, fuzzy matching |
| `src/embeddings.ts` | `src/embeddings.test.ts` | Embedding generation, cosine similarity, skill matching |

## Mocking Rules

- **Mock external systems:** File system, network (HF_ENDPOINT), environment variables
- **Do not mock internal collaborators:** Test actual permission logic, actual fuzzy matching
- **Use real implementations where feasible:** Embedding tests use the actual Transformers.js model

## Test Data Management

- Use inline test data for small, focused tests
- Use `beforeEach`/`afterEach` to manage environment variable state
- Randomize non-deterministic fields where appropriate

## Anti-Patterns

- Do not test framework behavior (OpenCode plugin API)
- Do not test private methods directly (test through public functions)
- Do not share mutable state between tests
- Do not assert on exact error messages from external systems

## Running Tests

```bash
# All tests
bun test

# Single test file
bun test path/to/file.test.ts

# Tests matching a pattern
bun test --grep "pattern"

# Type checking
bun run typecheck
```

## CI Requirements

- `bun test` must pass
- `bun run typecheck` must pass
- Both are enforced in development workflow
