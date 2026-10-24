import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runCommand } from "../src/lib/util.js";
import { inspectProject } from "../src/lib/project.js";
import { expandIntent } from "../src/lib/intent.js";
import { generateOptions } from "../src/lib/options.js";
import { createTaskSpec, loadTaskSpec, listTaskSpecs, TaskSpecSchema } from "../src/lib/spec.js";
import { checkChangeScope } from "../src/lib/policy.js";
import { takeBaseline } from "../src/lib/git.js";

let fixture: string;

function git(args: string[]) {
  const r = runCommand("git", args, { cwd: fixture });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

beforeAll(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), "pp-spec-"));
  fs.mkdirSync(path.join(fixture, "src"), { recursive: true });
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ name: "f", scripts: { test: "node -e 0" } }));
  fs.writeFileSync(path.join(fixture, "src", "app.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(fixture, "src", "keep.ts"), "export const k = 1;\n");
  git(["init", "-b", "main"]);
  git(["config", "user.email", "t@t"]);
  git(["config", "user.name", "t"]);
  git(["add", "."]);
  git(["commit", "-m", "init"]);
});

afterAll(() => {
  fs.rmSync(fixture, { recursive: true, force: true });
});

beforeEach(() => {
  // reset working tree to committed state
  runCommand("git", ["checkout", "--", "."], { cwd: fixture });
  runCommand("git", ["clean", "-fd"], { cwd: fixture });
});

function makeSpec(overrides: { allowedFiles?: string[]; save?: boolean } = {}) {
  const request = "Add a count badge to the app";
  const inspection = inspectProject(fixture);
  const expansion = expandIntent(request, inspection);
  const options = generateOptions(request, inspection, expansion, 3);
  return createTaskSpec({
    request,
    root: fixture,
    inspection,
    expansion,
    options,
    extraAllowedFiles: overrides.allowedFiles ?? ["src/app.ts"],
    save: overrides.save ?? true,
  });
}

test("createTaskSpec produces a valid, persisted spec", () => {
  const { spec, savedPath } = makeSpec();
  expect(TaskSpecSchema.parse(spec).id).toBe(spec.id);
  expect(savedPath).toContain(".promptpilot/specs/");
  expect(fs.existsSync(path.join(fixture, ".promptpilot", "specs", `${spec.id}.json`))).toBe(true);
  expect(loadTaskSpec(fixture, spec.id).id).toBe(spec.id);
  expect(listTaskSpecs(fixture)).toContain(spec.id);
  expect(spec.verification.commands.length).toBeGreaterThan(0); // auto-detected from scripts
});

test("in-scope change passes, out-of-scope change is a violation", () => {
  const { spec } = makeSpec();
  fs.writeFileSync(path.join(fixture, "src", "app.ts"), "export const a = 2;\n");
  fs.writeFileSync(path.join(fixture, "src", "keep.ts"), "export const k = 2;\n");
  const report = checkChangeScope(spec, fixture);
  expect(report.verdict).toBe("scope-violation");
  const byFile = Object.fromEntries(report.findings.map((f) => [f.file, f]));
  expect(byFile["src/app.ts"].severity).toBe("ok");
  expect(byFile["src/keep.ts"].severity).toBe("violation");
  expect(report.summary.outOfScope).toBe(1);
  expect(report.instructions.some((i) => i.includes("Stop"))).toBe(true);
});

test("dependency manifest change requires approval even inside scope", () => {
  const { spec } = makeSpec({ allowedFiles: ["src/app.ts", "package.json"] });
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ name: "f", scripts: {}, dependencies: { x: "1" } }));
  const report = checkChangeScope(spec, fixture);
  expect(report.verdict).toBe("needs-approval");
  expect(report.findings[0].categories).toContain("dependency-change");
});

test("protected paths are always violations", () => {
  const { spec } = makeSpec({ allowedFiles: ["**"] });
  fs.writeFileSync(path.join(fixture, ".env"), "SECRET=1\n");
  const report = checkChangeScope(spec, fixture);
  const finding = report.findings.find((f) => f.file === ".env");
  expect(finding?.severity).toBe("violation");
  expect(finding?.reason).toContain("Protected");
});

test("deleting a file is a violation under default policy", () => {
  const { spec } = makeSpec({ allowedFiles: ["src/**"] });
  fs.rmSync(path.join(fixture, "src", "keep.ts"));
  const report = checkChangeScope(spec, fixture);
  const finding = report.findings.find((f) => f.file === "src/keep.ts");
  expect(finding?.severity).toBe("violation");
  expect(finding?.reason).toContain("deletion");
});

test("baseline protects pre-existing user changes", () => {
  // user edits before the task starts
  fs.writeFileSync(path.join(fixture, "src", "keep.ts"), "export const k = 999;\n");
  const baseline = takeBaseline(fixture);
  expect(baseline.dirtyFiles).toContain("src/keep.ts");

  // task edits the same file
  fs.writeFileSync(path.join(fixture, "src", "keep.ts"), "export const k = 1000;\n");
  const { spec } = makeSpec({ allowedFiles: ["src/**"] });
  const report = checkChangeScope(spec, fixture, { baseline });
  expect(report.baselineFilesTouched).toContain("src/keep.ts");
  expect(report.instructions.some((i) => i.includes("Pre-existing user changes were modified"))).toBe(true);
});
