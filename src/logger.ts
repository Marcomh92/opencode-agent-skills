import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

const LOG_DIR = path.join(homedir(), ".config", "opencode", "opencode-agent-skills");
/** Explicit file-path override, honored verbatim as the single active log.
 * Empty string is treated as unset (falls through to the default timestamped path). */
const LOG_FILE_OVERRIDE = process.env.OPENCODE_AGENT_SKILLS_LOG_FILE;
const DEFAULT_LOG_FILE = LOG_FILE_OVERRIDE || path.join(LOG_DIR, "debug.log");
/** Session logs older than this are pruned at session start. */
const MAX_LOG_AGE_MS = 10 * 24 * 60 * 60 * 1000;

/** Active log file for the current session, set by {@link initSessionLog}.
 * @remarks Module-level, so this assumes one plugin instance (session) per process — matching how
 * OpenCode invokes the plugin factory. Concurrent sessions in one process would share the latest file. */
let activeLogFile = DEFAULT_LOG_FILE;

/** Remove log files older than 10 days. Best-effort; never throws. */
async function pruneOldLogs(): Promise<void> {
  const cutoff = Date.now() - MAX_LOG_AGE_MS;
  try {
    for (const entry of await fs.readdir(LOG_DIR)) {
      // Session logs (`debug-*.log`) and the legacy `debug.log`; not e.g. "debugger.log".
      if (entry !== "debug.log" && !/^debug-.*\.log$/.test(entry)) continue;
      const file = path.join(LOG_DIR, entry);
      const stat = await fs.stat(file);
      if (stat.mtimeMs < cutoff) await fs.unlink(file);
    }
  } catch {
    // Logging is best-effort; never throw
  }
}

/** Start a fresh per-session log file and prune logs older than 10 days.
 * @remarks Without an override the file is timestamped (`debug-<ISO>-<rand>.log`) under the default config
 * dir and old logs are pruned. An explicit `OPENCODE_AGENT_SKILLS_LOG_FILE` is used verbatim and is
 * neither timestamped nor pruned. */
export async function initSessionLog(): Promise<void> {
  // ponytail: env override = one exact path; switch to per-session files there only if needed.
  activeLogFile =
    LOG_FILE_OVERRIDE ||
    path.join(
      LOG_DIR,
      // Random suffix guards against two sessions starting in the same millisecond.
      `debug-${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 6)}.log`,
    );
  try {
    await fs.mkdir(path.dirname(activeLogFile), { recursive: true });
    await fs.writeFile(activeLogFile, "", "utf-8");
  } catch {
    // Logging is best-effort; never throw
  }
  if (!LOG_FILE_OVERRIDE) await pruneOldLogs();
}

/** Append a timestamped line to the active session log file, creating the parent directory if missing.
 * @remarks Default path is under the user config dir; override via the `OPENCODE_AGENT_SKILLS_LOG_FILE` env var. */
export async function log(message: string): Promise<void> {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    await fs.mkdir(path.dirname(activeLogFile), { recursive: true });
    await fs.appendFile(activeLogFile, line, "utf-8");
  } catch {
    // Logging is best-effort; never throw
  }
}
