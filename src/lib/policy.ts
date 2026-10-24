import { matchesGlob } from "./util.js";
import { gitState, Baseline } from "./git.js";
import type { TaskSpec } from "./spec.js";

export type ChangeCategory =
  | "dependency-change"
  | "database-migration"
  | "auth-or-config"
  | "public-api-change"
  | "file-deletion"
  | "code"
  | "docs"
  | "tests"
  | "other";

export interface ScopeFinding {
  file: string;
  status: string;
  inScope: boolean;
  matchedBy: string | null;
  categories: ChangeCategory[];
  severity: "ok" | "warning" | "violation";
  reason: string;
}

export interface ScopeReport {
  verdict: "within-scope" | "needs-approval" | "scope-violation";
  checkedAt: string;
  baselineFilesPreserved: string[];
  baselineFilesTouched: string[];
  findings: ScopeFinding[];
  summary: {
    totalChanges: number;
    inScope: number;
    outOfScope: number;
    requiringApproval: number;
    deleted: number;
  };
  instructions: string[];
}

const DEP_MANIFESTS = [
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "requirements.txt",
  "pyproject.toml",
  "poetry.lock",
  "go.mod",
  "go.sum",
  "Cargo.toml",
  "Cargo.lock",
  "Gemfile",
  "Gemfile.lock",
];

const MIGRATION_PATTERNS = [
  "**/migrations/**",
  "**/alembic/**",
  "**/prisma/migrations/**",
  "**/db/migrate/**",
  "**/*.sql",
  "**/schema.prisma",
];

const AUTH_PATTERNS = [
  "**/*auth*",
  "**/*login*",
  "**/*session*",
  "**/*token*",
  "**/*permission*",
  "**/*role*",
  "**/.env",
  "**/.env.*",
  "**/config.*",
  "**/*secret*",
  "**/*credential*",
];

const API_PATTERNS = ["**/api/**", "**/routes/**", "**/controllers/**", "**/endpoints/**"];

function classify(file: string, status: string): ChangeCategory[] {
  const cats: ChangeCategory[] = [];
  const base = file.split("/").pop() ?? file;
  if (DEP_MANIFESTS.includes(base)) cats.push("dependency-change");
  if (matchesGlob(file, MIGRATION_PATTERNS)) cats.push("database-migration");
  if (matchesGlob(file, AUTH_PATTERNS)) cats.push("auth-or-config");
  if (matchesGlob(file, API_PATTERNS)) cats.push("public-api-change");
  if (status === "deleted") cats.push("file-deletion");
  if (/\.(test|spec)\.[a-z]+$/.test(file) || /(^|\/)(tests?|__tests__)\//.test(file)) cats.push("tests");
  else if (/\.(md|mdx|txt|rst)$/.test(file)) cats.push("docs");
  else if (cats.length === 0) cats.push("code");
  return Array.from(new Set(cats));
}

function firstMatch(file: string, patterns: string[]): string | null {
  return patterns.find((p) => matchesGlob(file, [p])) ?? null;
}

/** Compare actual (or proposed) changes against the approved boundaries in a TaskSpec. */
export function checkChangeScope(
  spec: Pick<TaskSpec, "changeScope">,
  root: string,
  opts: { files?: Array<{ path: string; status: string }>; baseline?: Baseline } = {}
): ScopeReport {
  const changes =
    opts.files ??
    gitState(root).changes.map((c) => ({ path: c.path, status: c.status }));

  const findings: ScopeFinding[] = [];
  for (const change of changes) {
    const file = change.path.replace(/\\/g, "/");
    // PromptPilot's own state directory is never a task change.
    if (file === ".promptpilot" || file.startsWith(".promptpilot/")) continue;
    const categories = classify(file, change.status);

    const inProtected = firstMatch(file, spec.changeScope.protectedPaths);
    const matchedBy = firstMatch(file, spec.changeScope.allowedFiles);
    const inScope = matchedBy !== null && inProtected === null;

    const needsApproval = categories.filter((c) =>
      spec.changeScope.requiresApproval.includes(c as never)
    );

    let severity: ScopeFinding["severity"] = "ok";
    let reason = inScope ? "Inside approved scope." : "Outside the approved file scope.";

    if (inProtected) {
      severity = "violation";
      reason = `Protected path (${inProtected}) must never be modified.`;
    } else if (change.status === "deleted" && needsApproval.includes("file-deletion")) {
      severity = "violation";
      reason = "File deletion requires explicit approval under this spec's policy.";
    } else if (!inScope && needsApproval.length > 0) {
      severity = "violation";
      reason = `Out of scope and triggers approval-required categories: ${needsApproval.join(", ")}.`;
    } else if (needsApproval.length > 0) {
      severity = "warning";
      reason = `In scope but touches approval-required categories: ${needsApproval.join(", ")}.`;
    } else if (!inScope) {
      severity = "violation";
    }

    findings.push({ file, status: change.status, inScope, matchedBy, categories, severity, reason });
  }

  const baselineFilesTouched: string[] = [];
  const baselineFilesPreserved: string[] = [];
  if (opts.baseline) {
    const changedNow = new Set(findings.map((f) => f.file));
    for (const f of opts.baseline.dirtyFiles) {
      if (changedNow.has(f)) baselineFilesTouched.push(f);
      else baselineFilesPreserved.push(f);
    }
  }

  const outOfScope = findings.filter((f) => !f.inScope).length;
  const violations = findings.filter((f) => f.severity === "violation").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;

  const verdict: ScopeReport["verdict"] =
    violations > 0 ? "scope-violation" : warnings > 0 ? "needs-approval" : "within-scope";

  const instructions: string[] = [];
  if (violations > 0) {
    instructions.push("Stop: revert or justify the out-of-scope/protected changes before continuing.");
    instructions.push("Never reset the working tree wholesale — reverts must be targeted.");
  }
  if (warnings > 0) {
    instructions.push("Ask for explicit approval on flagged categories (deps, migrations, auth/config) before keeping those changes.");
  }
  if (baselineFilesTouched.length > 0) {
    instructions.push(
      `Pre-existing user changes were modified (${baselineFilesTouched.join(", ")}). Restore them — user work is not yours to overwrite.`
    );
  }
  if (instructions.length === 0) {
    instructions.push("All changes are inside the approved scope. Proceed to verification.");
  }

  return {
    verdict,
    checkedAt: new Date().toISOString(),
    baselineFilesPreserved,
    baselineFilesTouched,
    findings,
    summary: {
      totalChanges: findings.length,
      inScope: findings.length - outOfScope,
      outOfScope,
      requiringApproval: warnings + violations,
      deleted: findings.filter((f) => f.status === "deleted").length,
    },
    instructions,
  };
}
