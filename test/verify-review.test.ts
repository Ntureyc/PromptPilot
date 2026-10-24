import { test, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runVerification, verifyImplementation } from "../src/lib/verify.js";
import { reviewImplementation } from "../src/lib/review.js";
import { createTaskSpec } from "../src/lib/spec.js";
import { runCommand } from "../src/lib/util.js";

test("runVerification captures real exit codes and evidence", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-verify-"));
  const report = runVerification(dir, [
    { label: "passing", command: "node -e \"process.exit(0)\"" },
    { label: "failing", command: "node -e \"process.exit(3)\"" },
    { label: "missing-tool", command: "definitely-not-a-real-command-xyz" },
  ]);
  expect(report.results[0].status).toBe("passed");
  expect(report.results[1].status).toBe("failed");
  expect(report.results[1].exitCode).toBe(3);
  expect(report.results[2].status).toBe("failed");
  expect(report.overall).toBe("failed");
  expect(report.results[0].evidence).toContain("exit code: 0");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("empty command list reports no-checks, never fake success", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-verify2-"));
  const report = runVerification(dir, []);
  expect(report.overall).toBe("no-checks");
  expect(report.notes.some((n) => n.includes("did not run"))).toBe(true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("reviewImplementation gives evidence-based verdicts and marks unverified items", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-review-"));
  runCommand("git", ["init", "-b", "main"], { cwd: dir });
  runCommand("git", ["config", "user.email", "t@t"], { cwd: dir });
  runCommand("git", ["config", "user.name", "t"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "r", scripts: { test: "node -e 0" } }));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "a.ts"), "export {};\n");
  runCommand("git", ["add", "."], { cwd: dir });
  runCommand("git", ["commit", "-m", "init"], { cwd: dir });

  const { spec } = createTaskSpec({
    request: "Add greeting to a.ts",
    root: dir,
    extraAllowedFiles: ["src/a.ts"],
    save: true,
  });

  // implementation inside scope
  fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const greeting = 'hi';\n");

  const review = reviewImplementation(spec, dir, { runChecks: true });
  expect(review.verdict).toBe("ready-for-human-review");
  expect(review.verification.overall).toBe("passed");
  const scopeCriterion = review.criteria.find((c) => c.check === "check_change_scope");
  expect(scopeCriterion?.status).toBe("evidence-pass");
  const verifyCriterion = review.criteria.find((c) => c.check === "verify_implementation");
  expect(verifyCriterion?.status).toBe("evidence-pass");
  expect(review.criteria.some((c) => c.status === "unverified")).toBe(true); // semantic criteria stay honest
  expect(review.unverified.length).toBeGreaterThan(0);

  // now break scope and re-review
  fs.writeFileSync(path.join(dir, "src", "other.ts"), "export {};\n");
  const review2 = reviewImplementation(spec, dir, { runChecks: false });
  expect(review2.verdict).toBe("needs-changes");
  expect(review2.risks.some((r) => r.includes("scope"))).toBe(true);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("verifyImplementation runs a spec's own commands", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-verify3-"));
  const { spec } = createTaskSpec({
    request: "demo",
    root: dir,
    verificationCommands: [{ label: "echo", command: "node -e \"console.log('ok')\"" }],
    save: false,
  });
  const report = verifyImplementation(spec, dir);
  expect(report.overall).toBe("passed");
  expect(report.results[0].evidence).toContain("ok");
  fs.rmSync(dir, { recursive: true, force: true });
});
