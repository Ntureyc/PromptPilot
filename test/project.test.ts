import { test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runCommand } from "../src/lib/util.js";
import { inspectProject } from "../src/lib/project.js";

let fixture: string;

beforeAll(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), "pp-project-"));
  fs.mkdirSync(path.join(fixture, "src", "components"), { recursive: true });
  fs.writeFileSync(
    path.join(fixture, "package.json"),
    JSON.stringify(
      {
        name: "fixture-app",
        version: "0.1.0",
        scripts: { lint: "eslint .", test: "vitest run", build: "tsc", typecheck: "tsc --noEmit" },
        dependencies: { next: "15.0.0", react: "19.0.0", "react-dom": "19.0.0", tailwindcss: "4.0.0" },
        devDependencies: { typescript: "5.6.0", vitest: "2.0.0" },
      },
      null,
      2
    )
  );
  fs.writeFileSync(path.join(fixture, "AGENTS.md"), "# Agents\nUse Tailwind tokens. Never touch auth.\n");
  fs.writeFileSync(path.join(fixture, "tsconfig.json"), "{}");
  fs.writeFileSync(path.join(fixture, "src", "components", "Header.tsx"), "export const Header = () => null;\n");
  fs.writeFileSync(path.join(fixture, "README.md"), "# Fixture App\nA demo.\n");
});

afterAll(() => {
  fs.rmSync(fixture, { recursive: true, force: true });
});

test("inspectProject finds manifests, scripts and instruction files", () => {
  const p = inspectProject(fixture);
  expect(p.manifests.some((m) => m.kind === "npm")).toBe(true);
  expect(p.scripts.test).toBe("vitest run");
  expect(p.instructionFiles.map((f) => f.file)).toContain("AGENTS.md");
  expect(p.projectType).toContain("npm");
});

test("inspectProject detects the stack and frameworks", () => {
  const p = inspectProject(fixture);
  expect(p.frameworks).toContain("next.js");
  expect(p.frameworks).toContain("tailwindcss");
  expect(p.detectedStack).toContain("typescript");
});

test("inspectProject reports structure and file counts", () => {
  const p = inspectProject(fixture);
  expect(p.structure.fileCount).toBeGreaterThanOrEqual(4);
  expect(p.structure.byExtension[".tsx"]).toBe(1);
  expect(p.structure.top).toContain("src/");
});

test("inspectProject reports git state on a non-repo as not a repo", () => {
  const p = inspectProject(fixture);
  expect(p.git.isRepo).toBe(false);
});

test("git state inside a real repo reports dirty files", () => {
  runCommand("git", ["init", "-b", "main"], { cwd: fixture });
  runCommand("git", ["config", "user.email", "t@t"], { cwd: fixture });
  runCommand("git", ["config", "user.name", "t"], { cwd: fixture });
  runCommand("git", ["add", "."], { cwd: fixture });
  runCommand("git", ["commit", "-m", "init"], { cwd: fixture });
  fs.writeFileSync(path.join(fixture, "src", "components", "Header.tsx"), "export const Header = () => 1;\n");
  fs.writeFileSync(path.join(fixture, "src", "new-file.ts"), "export {};\n");
  const p = inspectProject(fixture);
  expect(p.git.isRepo).toBe(true);
  expect(p.git.changedFiles).toContain("src/components/Header.tsx");
  expect(p.git.changedFiles).toContain("src/new-file.ts");
  expect(p.notes.some((n) => n.includes("dirty"))).toBe(true);
});
