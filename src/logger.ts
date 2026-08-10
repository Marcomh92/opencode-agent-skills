import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

const LOG_FILE =
  process.env.OPENCODE_AGENT_SKILLS_LOG_FILE ||
  path.join(homedir(), ".config", "opencode", "opencode-agent-skills", "debug.log");

/** Truncate the debug log file, creating the parent directory if missing. */
export async function clearLog(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.writeFile(LOG_FILE, "", "utf-8");
  } catch {
    // Logging is best-effort; never throw
  }
}

/** Append a timestamped line to the debug log file, creating the parent directory if missing.
 * @remarks Default path is under the user config dir; override via the `OPENCODE_AGENT_SKILLS_LOG_FILE` env var. */
export async function log(message: string): Promise<void> {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.appendFile(LOG_FILE, line, "utf-8");
  } catch {
    // Logging is best-effort; never throw
  }
}
