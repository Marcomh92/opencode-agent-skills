import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";

const ENV_VAR = "OPENCODE_AGENT_SKILLS_LOG_FILE";
const DEFAULT_DIR = path.join(".config", "opencode", "opencode-agent-skills");
const DEFAULT_FILE = "debug.log";

/**
 * Dynamic import with a cache-busting query string so the LOG_FILE constant
 * inside src/logger.ts is re-evaluated against the current env var.
 * LOG_FILE is a module-level const, so each test needs a fresh module instance.
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

  test("clearLog truncates the log file", async () => {
    const logFile = path.join(tempDir, "debug.log");
    process.env[ENV_VAR] = logFile;
    const { clearLog, log } = await loadLogger();

    await log("first line");
    await log("second line");
    const before = await fs.readFile(logFile, "utf-8");
    expect(before.length).toBeGreaterThan(0);

    await clearLog();

    const after = await fs.readFile(logFile, "utf-8");
    expect(after).toBe("");
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

  test("env var override routes to custom path", async () => {
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
