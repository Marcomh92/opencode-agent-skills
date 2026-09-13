import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";

const ENV_VAR = "OPENCODE_AGENT_SKILLS_LOG_FILE";
const DEFAULT_DIR = path.join(".config", "opencode", "opencode-agent-skills");
const DEFAULT_FILE = "debug.log";

/**
 * Dynamic import with a cache-busting query string so LOG_FILE_OVERRIDE and
 * LOG_DIR inside src/logger.ts are re-evaluated against the current env vars.
 * Both are module-level consts, so each test needs a fresh module instance.
 */
async function loadLogger(): Promise<typeof import("./logger")> {
  return await import(`./logger.ts?bust=${Date.now()}-${Math.random()}`);
}

describe("logger", () => {
  let tempDir: string;
  let originalEnv: string | undefined;
  let originalHomedir: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(async () => {
    originalEnv = process.env[ENV_VAR];
    originalHomedir = homedir();
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "logger-test-"));
  });

  afterEach(async () => {
    // Restore env var
    if (originalEnv === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = originalEnv;
    }
    // Restore homedir-related env vars
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    // Clean up temp dir
    if (tempDir && existsSync(tempDir)) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("initSessionLog creates a timestamped debug-*.log file in default dir", async () => {
    // Redirect homedir to a controlled temp dir so we don't touch the real config
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;
    delete process.env[ENV_VAR];

    const { initSessionLog } = await loadLogger();
    await initSessionLog();

    const defaultLogDir = path.join(tempDir, DEFAULT_DIR);
    const entries = await fs.readdir(defaultLogDir);

    // A timestamped debug-*.log file must exist, distinct from the legacy debug.log
    const sessionLog = entries.find((e) => /^debug-.+\.log$/.test(e));
    expect(sessionLog).toBeDefined();
    if (!sessionLog) throw new Error("unreachable: session log not found");
    expect(sessionLog).not.toBe(DEFAULT_FILE);

    // initSessionLog creates the file empty
    const content = await fs.readFile(path.join(defaultLogDir, sessionLog), "utf-8");
    expect(content).toBe("");
  });

  test("two initSessionLog calls produce two distinct session files and log() writes to newer", async () => {
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;
    delete process.env[ENV_VAR];

    const { initSessionLog, log } = await loadLogger();
    await initSessionLog();
    // ISO timestamps have millisecond precision — wait briefly so the next file gets a distinct name
    await new Promise((r) => setTimeout(r, 5));
    await initSessionLog();

    const defaultLogDir = path.join(tempDir, DEFAULT_DIR);
    const sessionFiles = (await fs.readdir(defaultLogDir)).filter((e) =>
      /^debug-.+\.log$/.test(e),
    );
    expect(sessionFiles.length).toBe(2);

    // Determine newer/older by mtime (readdir order is not guaranteed)
    const stats = await Promise.all(
      sessionFiles.map((f) => fs.stat(path.join(defaultLogDir, f))),
    );
    const newerIdx = stats[1]!.mtimeMs >= stats[0]!.mtimeMs ? 1 : 0;
    const newerFile = sessionFiles[newerIdx]!;
    const olderFile = sessionFiles[1 - newerIdx]!;

    await log("newer session wins");

    const newerContent = await fs.readFile(path.join(defaultLogDir, newerFile), "utf-8");
    expect(newerContent).toContain("newer session wins");

    const olderContent = await fs.readFile(path.join(defaultLogDir, olderFile), "utf-8");
    expect(olderContent).not.toContain("newer session wins");
  });

  test("initSessionLog prunes debug-*.log older than 10 days but keeps fresh ones", async () => {
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;
    delete process.env[ENV_VAR];

    const defaultLogDir = path.join(tempDir, DEFAULT_DIR);
    await fs.mkdir(defaultLogDir, { recursive: true });

    const oldName = "debug-2020-01-01T00-00-00-000Z.log";
    const freshName = "debug-2030-01-01T00-00-00-000Z.log";
    const oldPath = path.join(defaultLogDir, oldName);
    const freshPath = path.join(defaultLogDir, freshName);
    await fs.writeFile(oldPath, "ancient session", "utf-8");
    await fs.writeFile(freshPath, "recent session", "utf-8");

    const elevenDaysAgo = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await fs.utimes(oldPath, elevenDaysAgo, elevenDaysAgo);
    await fs.utimes(freshPath, oneHourAgo, oneHourAgo);

    const { initSessionLog } = await loadLogger();
    await initSessionLog();

    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(freshPath)).toBe(true);
  });

  test("pruning uses strict < cutoff at the 10-day boundary (10d kept, 10d+1h pruned)", async () => {
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;
    delete process.env[ENV_VAR];

    const defaultLogDir = path.join(tempDir, DEFAULT_DIR);
    await fs.mkdir(defaultLogDir, { recursive: true });

    // "Exactly 10 days old" is set a few seconds under the cutoff to absorb the
    // millisecond drift between fixture setup and pruneOldLogs computing its cutoff.
    const keptName = "debug-boundary-keep.log";
    const prunedName = "debug-boundary-prune.log";
    const keptPath = path.join(defaultLogDir, keptName);
    const prunedPath = path.join(defaultLogDir, prunedName);
    await fs.writeFile(keptPath, "right at the cutoff", "utf-8");
    await fs.writeFile(prunedPath, "just past the cutoff", "utf-8");

    const tenDaysMinusFiveSeconds = new Date(Date.now() - (10 * 24 * 60 * 60 * 1000 - 5_000));
    const tenDaysPlusOneHour = new Date(Date.now() - (10 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000));
    await fs.utimes(keptPath, tenDaysMinusFiveSeconds, tenDaysMinusFiveSeconds);
    await fs.utimes(prunedPath, tenDaysPlusOneHour, tenDaysPlusOneHour);

    const { initSessionLog } = await loadLogger();
    await initSessionLog();

    expect(existsSync(keptPath)).toBe(true);
    expect(existsSync(prunedPath)).toBe(false);
  });

  test("pruning leaves non-matching filenames (debugger.log, notes.log) alone", async () => {
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;
    delete process.env[ENV_VAR];

    const defaultLogDir = path.join(tempDir, DEFAULT_DIR);
    await fs.mkdir(defaultLogDir, { recursive: true });

    // Genuine session log — must be pruned
    const sessionPath = path.join(defaultLogDir, "debug-2020-01-01T00-00-00-000Z.log");
    await fs.writeFile(sessionPath, "real old session", "utf-8");

    // Names that look similar but don't match the filter — must survive
    const debuggerPath = path.join(defaultLogDir, "debugger.log");
    const notesPath = path.join(defaultLogDir, "notes.log");
    await fs.writeFile(debuggerPath, "looks like a log", "utf-8");
    await fs.writeFile(notesPath, "unrelated notes", "utf-8");

    const ancient = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await fs.utimes(sessionPath, ancient, ancient);
    await fs.utimes(debuggerPath, ancient, ancient);
    await fs.utimes(notesPath, ancient, ancient);

    const { initSessionLog } = await loadLogger();
    await initSessionLog();

    expect(existsSync(sessionPath)).toBe(false);
    expect(existsSync(debuggerPath)).toBe(true);
    expect(existsSync(notesPath)).toBe(true);
  });

  test("env var override is used verbatim and is not pruned", async () => {
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;

    const overrideFile = path.join(tempDir, "my-override.log");
    process.env[ENV_VAR] = overrideFile;

    // Pre-create an old debug-*.log in the default dir that would normally be pruned
    const defaultLogDir = path.join(tempDir, DEFAULT_DIR);
    await fs.mkdir(defaultLogDir, { recursive: true });
    const oldSessionLog = path.join(defaultLogDir, "debug-old-session.log");
    await fs.writeFile(oldSessionLog, "ancient session", "utf-8");
    const ancient = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await fs.utimes(oldSessionLog, ancient, ancient);

    const { initSessionLog, log } = await loadLogger();
    await initSessionLog();

    // Override path is used verbatim (no timestamp, no extra suffix)
    expect(existsSync(overrideFile)).toBe(true);

    // No new files should appear in the default dir under override
    const defaultEntries = await fs.readdir(defaultLogDir);
    expect(defaultEntries).toEqual(["debug-old-session.log"]);

    // The old debug-*.log must NOT be pruned when override is set
    expect(existsSync(oldSessionLog)).toBe(true);

    await log("override path");
    const overrideContent = await fs.readFile(overrideFile, "utf-8");
    expect(overrideContent).toContain("override path");
    const oldContent = await fs.readFile(oldSessionLog, "utf-8");
    expect(oldContent).not.toContain("override path");
  });

  test("log appends a timestamped line", async () => {
    const logFile = path.join(tempDir, "debug.log");
    process.env[ENV_VAR] = logFile;
    const { log } = await loadLogger();

    await log("hello");

    const content = await fs.readFile(logFile, "utf-8");
    expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*Z\] hello\n$/);
  });

  test("mkdir auto-creates parent directory", async () => {
    const logFile = path.join(tempDir, "nested", "subdir", "debug.log");
    process.env[ENV_VAR] = logFile;
    const { log } = await loadLogger();

    expect(existsSync(path.dirname(logFile))).toBe(false);

    await log("hello");

    expect(existsSync(path.dirname(logFile))).toBe(true);
    const content = await fs.readFile(logFile, "utf-8");
    expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*Z\] hello\n$/);
  });

  test("env var override routes log() to custom path", async () => {
    const logFile = path.join(tempDir, "custom.log");
    process.env[ENV_VAR] = logFile;
    const { log } = await loadLogger();

    await log("custom location test");

    const content = await fs.readFile(logFile, "utf-8");
    expect(content).toContain("custom location test");

    // The default location should NOT contain this message
    const defaultPath = path.join(originalHomedir, DEFAULT_DIR, DEFAULT_FILE);
    if (existsSync(defaultPath)) {
      const defaultContent = await fs.readFile(defaultPath, "utf-8");
      expect(defaultContent).not.toContain("custom location test");
    }
  });

  test("empty-string env var falls through to default path", async () => {
    // Redirect homedir-related env vars so homedir() returns our temp dir
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;

    process.env[ENV_VAR] = "";
    const { log } = await loadLogger();

    await log("default location test");

    const expectedFile = path.join(tempDir, DEFAULT_DIR, DEFAULT_FILE);
    const content = await fs.readFile(expectedFile, "utf-8");
    expect(content).toContain("default location test");
  });

  test("default path uses homedir-based convention", async () => {
    // Redirect homedir to a controlled temp dir so we don't write to the real one
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;

    // No env var override — use the default
    delete process.env[ENV_VAR];
    const { log } = await loadLogger();

    await log("default convention test");

    const expectedFile = path.join(tempDir, DEFAULT_DIR, DEFAULT_FILE);
    expect(existsSync(expectedFile)).toBe(true);
    const content = await fs.readFile(expectedFile, "utf-8");
    expect(content).toContain("default convention test");
  });

  test("log swallows errors silently", async () => {
    // Create a regular file, then point LOG_FILE at a path inside that file.
    // mkdir on the parent directory will fail because the parent is a file.
    const blockerFile = path.join(tempDir, "blocker");
    await fs.writeFile(blockerFile, "I am a regular file");
    const logFile = path.join(blockerFile, "debug.log");
    process.env[ENV_VAR] = logFile;
    const { log } = await loadLogger();

    // Should not throw; logging is best-effort
    await expect(log("unwritable")).resolves.toBeUndefined();
  });
});
