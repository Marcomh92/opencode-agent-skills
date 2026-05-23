import * as fs from "node:fs/promises";

const LOG_FILE = "C:\\Users\\marco\\.config\\opencode_plugins\\opencode-agent-skills\\debug.log";

export async function clearLog(): Promise<void> {
  try {
    await fs.writeFile(LOG_FILE, "", "utf-8");
  } catch {
    // Silently ignore logging errors
  }
}

export async function log(message: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  try {
    await fs.appendFile(LOG_FILE, line, "utf-8");
  } catch {
    // Silently ignore logging errors
  }
}
