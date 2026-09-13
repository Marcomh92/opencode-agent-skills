/**
 * Fresh-process probe for `src/embeddings.ts` graceful degradation.
 *
 * Run by `src/embeddings.test.ts` via `bun run`. The `.fixture.ts` suffix keeps
 * it out of `bun test` discovery — it must not run in the main test process.
 *
 * Why a subprocess: the parent test file statically imports
 * `@huggingface/transformers` for its real-model tests, so the package is
 * already in the module registry. Bun then evaluates a throwing
 * `mock.module()` factory eagerly at registration and does NOT register the
 * mock (the import falls back to the real module). A fresh process lets us
 * register the mock before the package is ever loaded, so the production
 * dynamic `import()` genuinely rejects — reproducing the native-addon load
 * failure that used to make OpenCode silently drop the whole plugin.
 *
 * Prints a JSON summary on stdout and exits non-zero when the contract is
 * violated.
 */
import { mock } from "bun:test";
import { tmpdir } from "node:os";
import * as path from "node:path";

// Keep the production log() call out of the user's real log file.
process.env.OPENCODE_AGENT_SKILLS_LOG_FILE = path.join(
  tmpdir(),
  `embeddings-import-failure-${Date.now()}.log`,
);

mock.module("@huggingface/transformers", () => {
  throw new Error("simulated native addon load failure");
});

const warnings: string[] = [];
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  warnings.push(args.map((arg) => String(arg)).join(" "));
};

try {
  // Must be dynamic: ESM static imports are hoisted above the mock.module()
  // call above.
  const { getEmbedding, matchSkills } = await import("./embeddings");

  const skills = [{ name: "git-helper", description: "Git workflow assistance" }];

  const first = await matchSkills("Help me commit my changes", skills);
  const second = await matchSkills("Help me create a branch", skills);

  let embeddingError = "";
  try {
    await getEmbedding("anything");
  } catch (err) {
    embeddingError = (err as Error).message;
  }

  console.error = originalConsoleError;

  const summary = {
    firstMatches: first.length,
    secondMatches: second.length,
    disabledWarnings: warnings.filter((w) => w.includes("Semantic matching disabled")).length,
    embeddingError,
  };
  console.log(JSON.stringify(summary));

  const contractHolds =
    summary.firstMatches === 0 &&
    summary.secondMatches === 0 &&
    summary.disabledWarnings === 1 &&
    summary.embeddingError.includes("Embeddings unavailable");
  if (!contractHolds) process.exit(1);
} catch (err) {
  console.error = originalConsoleError;
  console.log(JSON.stringify({ unexpectedError: (err as Error).message }));
  process.exit(1);
}
