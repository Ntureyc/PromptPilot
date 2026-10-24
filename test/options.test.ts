import { test, expect } from "bun:test";
import { generateOptions } from "../src/lib/options.js";
import { expandIntent } from "../src/lib/intent.js";

test("UI tasks produce distinct options with trade-offs", () => {
  const request = "Make the header look nice";
  const expansion = expandIntent(request);
  const set = generateOptions(request, undefined, expansion, 3);
  expect(set.options.length).toBe(3);
  expect(set.decisionNeeded).toBe(true);
  const names = set.options.map((o) => o.name);
  expect(new Set(names).size).toBe(3);
  for (const o of set.options) {
    expect(o.pros.length).toBeGreaterThan(0);
    expect(o.cons.length).toBeGreaterThan(0);
    expect(o.expectedTouch.length).toBeGreaterThan(0);
    expect(o.whenToChoose.length).toBeGreaterThan(0);
    expect(["low", "medium", "high"]).toContain(o.risk);
  }
});

test("fix tasks suggest targeted, root-cause and hardening options", () => {
  const request = "Fix the crash in the parser";
  const expansion = expandIntent(request);
  const set = generateOptions(request, undefined, expansion, 3);
  expect(set.taskCategory).toBe("fix");
  expect(set.options.map((o) => o.name)).toContain("Root-cause fix");
});

test("recommendation points at an existing option id", () => {
  const set = generateOptions("Add export to CSV", undefined, undefined, 2);
  expect(set.options.map((o) => o.id)).toContain(set.recommendation);
  expect(set.options.length).toBe(2);
});
