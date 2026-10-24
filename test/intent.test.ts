import { test, expect } from "bun:test";
import { expandIntent } from "../src/lib/intent.js";
import type { ProjectInspection } from "../src/lib/project.js";

const fakeInspection = {
  root: "/x",
  inspectedAt: new Date().toISOString(),
  projectType: "npm",
  manifests: [],
  instructionFiles: [{ file: "AGENTS.md", excerpt: "" }],
  detectedStack: ["typescript"],
  frameworks: ["next.js", "tailwindcss"],
  scripts: { test: "vitest run", lint: "eslint ." },
  structure: { top: [], fileCount: 10, byExtension: {} },
  git: { isRepo: true, changedFiles: ["a.ts"] },
  notes: [],
} as unknown as ProjectInspection;

test("classifies a vague UI request and flags the vague term", () => {
  const e = expandIntent("Build a navigation bar that looks nice.");
  expect(e.taskCategory).toBe("ui");
  expect(e.openQuestions.length).toBeGreaterThan(0);
  expect(e.openQuestions[0].suggestedOptions.length).toBeGreaterThan(0);
});

test("separates stated requirements from inferred ones", () => {
  const e = expandIntent("Build a navigation bar that looks nice.", fakeInspection);
  expect(e.statedRequirements.every((r) => r.source === "stated")).toBe(true);
  expect(e.inferredRequirements.length).toBeGreaterThan(0);
  expect(e.inferredRequirements.some((r) => r.text.includes("Tailwind"))).toBe(true);
});

test("assumptions always say how to verify them", () => {
  const e = expandIntent("Add a dashboard.", fakeInspection);
  for (const a of e.assumptions) {
    expect(a.verifyBy.length).toBeGreaterThan(0);
    expect(a.assumption.length).toBeGreaterThan(0);
  }
});

test("risk rises for auth/deletion wording", () => {
  expect(expandIntent("Update the login token flow").riskLevel).toBe("high");
  expect(expandIntent("Fix the off-by-one in the formatter").riskLevel).toBe("low");
  expect(expandIntent("Refactor the api client").riskLevel).toBe("medium");
});

test("acceptance criteria include scope and verification gates", () => {
  const e = expandIntent("Build a navigation bar.", fakeInspection);
  const checks = e.acceptanceCriteriaDraft.map((a) => a.check);
  expect(checks).toContain("check_change_scope");
  expect(checks).toContain("verify_implementation");
  expect(e.acceptanceCriteriaDraft[0].id).toBe("AC-1");
});

test("mentions detected paths and technologies", () => {
  const e = expandIntent("Fix the bug in src/components/Header.tsx using tailwind");
  expect(e.mentionedPaths).toContain("src/components/Header.tsx");
  expect(e.mentionedTechnologies).toContain("tailwind");
});
