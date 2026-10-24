import { spawnSync } from "node:child_process";
import * as path from "node:path";

/** Result of a child process run. */
export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

/** Run a command with arguments (no shell). Never throws; reports failure in the result. */
export function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {}
): RunResult {
  const started = Date.now();
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd,
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 60_000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    shell: false,
  });
  return {
    code: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    timedOut: res.error !== undefined && (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT",
    durationMs: Date.now() - started,
  };
}

/** Run a shell command line (used for user-authored verification commands). */
export function runShell(
  command: string,
  opts: { cwd?: string; timeoutMs?: number } = {}
): RunResult {
  const started = Date.now();
  const res = spawnSync(command, {
    cwd: opts.cwd,
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 300_000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    shell: true,
  });
  return {
    code: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    timedOut: res.error !== undefined && (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT",
    durationMs: Date.now() - started,
  };
}

/** Convert a glob (supports **, *, ?) into an anchored RegExp. */
export function globToRegExp(pattern: string): RegExp {
  let out = "";
  let i = 0;
  const p = pattern.replace(/\\/g, "/");
  while (i < p.length) {
    const ch = p[i];
    if (ch === "*") {
      if (p[i + 1] === "*") {
        // "**/" matches zero or more path segments; bare "**" matches anything.
        if (p[i + 2] === "/") {
          out += "(?:[^/]+/)*";
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      out += "[^/]";
      i += 1;
    } else if ("+.^${}()|[]".includes(ch)) {
      out += "\\" + ch;
      i += 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return new RegExp(`^${out}$`);
}

/** True when the relative path matches at least one glob. */
export function matchesGlob(relPath: string, patterns: string[]): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  return patterns.some((raw) => {
    const pattern = raw.replace(/\\/g, "/");
    const re = globToRegExp(pattern);
    if (re.test(normalized)) return true;
    // A bare directory name also covers everything inside it.
    if (!pattern.includes("/") && !pattern.includes("*")) {
      return normalized === pattern || normalized.startsWith(pattern + "/");
    }
    return false;
  });
}

/** Truncate text to max chars, marking the cut. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n… [truncated ${text.length - max} chars]`;
}

/** Normalize a filesystem path for comparison. */
export function normalizeRel(absPath: string, root: string): string {
  return path.relative(root, absPath).replace(/\\/g, "/");
}

export const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".cache",
  "coverage",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".promptpilot",
]);
