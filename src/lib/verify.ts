import { runShell, truncate } from "./util.js";
import type { TaskSpec } from "./spec.js";

export interface CheckResult {
  label: string;
  command: string;
  status: "passed" | "failed" | "timed-out" | "skipped";
  exitCode: number | null;
  durationMs: number;
  evidence: string;
}

export interface VerificationReport {
  ranAt: string;
  root: string;
  results: CheckResult[];
  overall: "passed" | "failed" | "no-checks";
  notes: string[];
}

export interface VerificationCommand {
  label: string;
  command: string;
  timeoutMs?: number;
}

/** Run verification commands and return real evidence (exit codes + output). */
export function runVerification(
  root: string,
  commands: VerificationCommand[],
  opts: { maxOutputChars?: number; notes?: string[] } = {}
): VerificationReport {
  const maxOut = opts.maxOutputChars ?? 8000;
  const results: CheckResult[] = [];

  if (commands.length === 0) {
    return {
      ranAt: new Date().toISOString(),
      root,
      results: [],
      overall: "no-checks",
      notes: [
        ...(opts.notes ?? []),
        "No verification commands were provided or detected. State explicitly that checks did not run.",
      ],
    };
  }

  for (const cmd of commands) {
    const res = runShell(cmd.command, { cwd: root, timeoutMs: cmd.timeoutMs ?? 300_000 });
    const status: CheckResult["status"] = res.timedOut
      ? "timed-out"
      : res.code === 0
        ? "passed"
        : "failed";
    const evidence =
      `exit code: ${res.code ?? "null"} (${res.durationMs} ms)\n` +
      `--- stdout ---\n${truncate(res.stdout.trim() || "(empty)", maxOut)}\n` +
      `--- stderr ---\n${truncate(res.stderr.trim() || "(empty)", maxOut)}`;
    results.push({
      label: cmd.label,
      command: cmd.command,
      status,
      exitCode: res.code,
      durationMs: res.durationMs,
      evidence,
    });
  }

  const anyFailed = results.some((r) => r.status === "failed" || r.status === "timed-out");
  return {
    ranAt: new Date().toISOString(),
    root,
    results,
    overall: anyFailed ? "failed" : "passed",
    notes: opts.notes ?? [],
  };
}

/** Convenience wrapper: run the checks recorded in a TaskSpec. */
export function verifyImplementation(spec: TaskSpec, root: string): VerificationReport {
  return runVerification(
    root,
    spec.verification.commands.map((c) => ({ label: c.label, command: c.command, timeoutMs: c.timeoutMs })),
    { notes: spec.verification.notes }
  );
}
