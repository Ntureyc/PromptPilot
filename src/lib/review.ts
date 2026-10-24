import type { TaskSpec } from "./spec.js";
import { checkChangeScope, ScopeReport } from "./policy.js";
import { runVerification, VerificationReport } from "./verify.js";
import { gitState } from "./git.js";
import type { Baseline } from "./git.js";

export interface CriterionAssessment {
  id: string;
  text: string;
  check: string;
  status: "evidence-pass" | "evidence-fail" | "unverified";
  evidence: string;
}

export interface ImplementationReview {
  reviewedAt: string;
  specId: string;
  title: string;
  verdict: "ready-for-human-review" | "needs-changes" | "blocked";
  scope: ScopeReport;
  verification: VerificationReport;
  criteria: CriterionAssessment[];
  changedFiles: Array<{ path: string; status: string }>;
  diffStat: string;
  risks: string[];
  unverified: string[];
  summary: string;
}

/** Evaluate an implementation against its TaskSpec with real evidence, never assumed success. */
export function reviewImplementation(
  spec: TaskSpec,
  root: string,
  opts: { baseline?: Baseline; verification?: VerificationReport; runChecks?: boolean } = {}
): ImplementationReview {
  const git = gitState(root);
  const changed = git.changes.map((c) => ({ path: c.path, status: c.status }));

  const scope = checkChangeScope(spec, root, { files: changed, baseline: opts.baseline });

  let verification = opts.verification;
  if (!verification && opts.runChecks) {
    verification = runVerification(
      root,
      spec.verification.commands.map((c) => ({ label: c.label, command: c.command, timeoutMs: c.timeoutMs })),
      { notes: spec.verification.notes }
    );
  }
  const verificationReport: VerificationReport = verification ?? {
    ranAt: new Date().toISOString(),
    root,
    results: [],
    overall: "no-checks",
    notes: ["Checks were not run for this review. Run verify_implementation before claiming success."],
  };

  const criteria: CriterionAssessment[] = spec.acceptanceCriteria.map((ac) => {
    if (ac.check === "check_change_scope") {
      const ok = scope.verdict === "within-scope" && scope.baselineFilesTouched.length === 0;
      return {
        id: ac.id,
        text: ac.text,
        check: ac.check,
        status: ok ? "evidence-pass" : "evidence-fail",
        evidence:
          `scope verdict: ${scope.verdict}; ` +
          `${scope.summary.outOfScope} out-of-scope file(s); ` +
          `${scope.baselineFilesTouched.length} pre-existing user file(s) touched`,
      };
    }
    if (ac.check === "verify_implementation") {
      if (verificationReport.overall === "passed") {
        return {
          id: ac.id,
          text: ac.text,
          check: ac.check,
          status: "evidence-pass",
          evidence: `all ${verificationReport.results.length} check(s) passed: ${verificationReport.results.map((r) => r.label).join(", ")}`,
        };
      }
      if (verificationReport.overall === "failed") {
        const failed = verificationReport.results.filter((r) => r.status !== "passed");
        return {
          id: ac.id,
          text: ac.text,
          check: ac.check,
          status: "evidence-fail",
          evidence: `failed check(s): ${failed.map((f) => `${f.label} (${f.status}, exit ${f.exitCode})`).join(", ")}`,
        };
      }
      return {
        id: ac.id,
        text: ac.text,
        check: ac.check,
        status: "unverified",
        evidence: "no checks were run or no checks exist for this project",
      };
    }
    return {
      id: ac.id,
      text: ac.text,
      check: ac.check,
      status: "unverified",
      evidence: "semantic criterion — requires human or agent judgment against the diff",
    };
  });

  const evidenceFail = criteria.filter((c) => c.status === "evidence-fail");
  const unverifiedList = criteria.filter((c) => c.status === "unverified").map((c) => `${c.id}: ${c.text}`);

  const risks: string[] = [];
  if (scope.verdict === "needs-approval") {
    risks.push("Changes touch approval-required categories (dependencies, migrations, auth/config, deletions).");
  }
  if (scope.verdict === "scope-violation") {
    risks.push("Changes fall outside the approved scope — see scope findings.");
  }
  if (scope.baselineFilesTouched.length > 0) {
    risks.push(`Pre-existing user changes were modified: ${scope.baselineFilesTouched.join(", ")}.`);
  }
  if (verificationReport.overall === "failed") {
    risks.push("At least one project check failed — the implementation is not verified.");
  }
  if (verificationReport.overall === "no-checks") {
    risks.push("No checks ran — correctness is unproven even if the diff looks clean.");
  }
  if (changed.length === 0) {
    risks.push("No file changes were detected — the task may not be implemented at all.");
  }

  const verdict: ImplementationReview["verdict"] =
    evidenceFail.length > 0 || scope.verdict === "scope-violation"
      ? "needs-changes"
      : changed.length === 0
        ? "blocked"
        : "ready-for-human-review";

  const summary =
    verdict === "needs-changes"
      ? `Needs changes: ${evidenceFail.length} acceptance criterion(a) failed evidence checks` +
        (scope.verdict === "scope-violation" ? " and the change scope was violated." : ".")
      : verdict === "blocked"
        ? "Blocked: no changes detected in the working tree."
        : `Ready for human review: ${changed.length} file(s) changed, ` +
          `${criteria.filter((c) => c.status === "evidence-pass").length}/${criteria.length} criteria backed by evidence` +
          (unverifiedList.length > 0 ? `, ${unverifiedList.length} still unverified.` : ".");

  return {
    reviewedAt: new Date().toISOString(),
    specId: spec.id,
    title: spec.title,
    verdict,
    scope,
    verification: verificationReport,
    criteria,
    changedFiles: changed,
    diffStat: git.diffStat,
    risks,
    unverified: unverifiedList,
    summary,
  };
}
