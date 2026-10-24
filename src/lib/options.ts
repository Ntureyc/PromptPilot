import type { ProjectInspection } from "./project.js";
import type { IntentExpansion } from "./intent.js";

export interface ImplementationOption {
  id: string;
  name: string;
  approach: string;
  pros: string[];
  cons: string[];
  risk: "low" | "medium" | "high";
  effort: "small" | "medium" | "large";
  whenToChoose: string;
  expectedTouch: string[];
}

export interface OptionSet {
  taskCategory: IntentExpansion["taskCategory"];
  options: ImplementationOption[];
  recommendation: string;
  decisionNeeded: boolean;
  decisionQuestion: string;
}

type Template = (ctx: { stack: string; target: string; hasExisting: boolean }) => Omit<
  ImplementationOption,
  "id"
>;

const UI_TEMPLATES: Template[] = [
  ({ stack, target }) => ({
    name: "Minimal refinement",
    approach: `Improve the existing ${target} in place: tighten typography, spacing and hover states while keeping the current structure, routes and behavior in ${stack}.`,
    pros: ["Smallest diff", "Low regression risk", "Preserves all existing behavior"],
    cons: ["May not satisfy a request that expects a visible redesign"],
    risk: "low",
    effort: "small",
    whenToChoose: "When the current structure is fine and only the polish is missing.",
    expectedTouch: ["the existing component file", "its colocated styles if any"],
  }),
  ({ stack, target }) => ({
    name: "Visual overhaul",
    approach: `Rework the ${target} layout and surface treatment (hierarchy, translucency/borders or stronger contrast) while preserving routes, auth hooks and callbacks in ${stack}.`,
    pros: ["Clearly visible result", "Still bounded to one area"],
    cons: ["Larger diff", "Needs a design decision before implementing"],
    risk: "medium",
    effort: "medium",
    whenToChoose: "When the user explicitly wants it to look different, not just tidier.",
    expectedTouch: ["the component file", "shared design tokens/theme config", "related tests"],
  }),
  ({ stack, target }) => ({
    name: "Component-system approach",
    approach: `Extract the ${target} into a reusable, configurable component with variants, then wire the existing call sites to it in ${stack}.`,
    pros: ["Pays down duplication", "Future changes become one-file edits"],
    cons: ["Touches every call site", "Highest regression surface of the three"],
    risk: "high",
    effort: "large",
    whenToChoose: "When several copies of this UI already exist across the project.",
    expectedTouch: ["new shared component", "all call sites", "shared styles", "tests"],
  }),
];

const FIX_TEMPLATES: Template[] = [
  ({ target }) => ({
    name: "Targeted fix",
    approach: `Change only the failing code path behind ${target}; leave surrounding logic untouched.`,
    pros: ["Minimal risk", "Easy to review"],
    cons: ["May leave the underlying design flaw in place"],
    risk: "low",
    effort: "small",
    whenToChoose: "When the root cause is clearly localized and the fix is obviously correct.",
    expectedTouch: ["the failing function/component", "a regression test"],
  }),
  ({ target }) => ({
    name: "Root-cause fix",
    approach: `Trace ${target} to the shared helper/state/contract that caused the failure and fix it there, then add a regression test covering the failure mode.`,
    pros: ["Fixes the whole class of bugs", "Adds lasting evidence"],
    cons: ["Wider diff", "Needs the failure reproduced first"],
    risk: "medium",
    effort: "medium",
    whenToChoose: "When the same bug can plausibly appear in other call sites.",
    expectedTouch: ["shared helper or contract", "call sites", "regression tests"],
  }),
  () => ({
    name: "Defensive hardening",
    approach: "Fix the failure and add validation/guard clauses around the boundary where bad input entered.",
    pros: ["Prevents recurrence from other inputs"],
    cons: ["Can mask upstream problems if over-applied"],
    risk: "medium",
    effort: "medium",
    whenToChoose: "When the failure came from unvalidated external input.",
    expectedTouch: ["the failing path", "input validation layer", "tests"],
  }),
];

const FEATURE_TEMPLATES: Template[] = [
  ({ stack, target, hasExisting }) => ({
    name: "Extend existing code",
    approach: `Add ${target} inside the existing ${hasExisting ? "structure" : "entry point"} in ${stack}, following current patterns and conventions.`,
    pros: ["Consistent with the codebase", "Small review surface"],
    cons: ["Constrained by the current structure"],
    risk: "low",
    effort: "medium",
    whenToChoose: "Default choice when an obvious home for the feature already exists.",
    expectedTouch: ["existing module/component", "its tests"],
  }),
  ({ stack, target }) => ({
    name: "New dedicated module",
    approach: `Create a self-contained module for ${target} in ${stack} with a narrow interface, then integrate it at one call site.`,
    pros: ["Clean boundary", "Easy to test in isolation"],
    cons: ["Adds a new file/abstraction that must be maintained"],
    risk: "medium",
    effort: "medium",
    whenToChoose: "When the feature has its own state/contract and would clutter existing files.",
    expectedTouch: ["new module", "one integration point", "unit tests"],
  }),
  ({ stack, target }) => ({
    name: "Reuse/extend shared layer",
    approach: `Implement ${target} as an extension of the existing shared component/hook/service layer in ${stack} so all consumers benefit.`,
    pros: ["No duplicated logic", "Consistent behavior everywhere"],
    cons: ["Changes shared code — all consumers are affected"],
    risk: "high",
    effort: "large",
    whenToChoose: "When multiple parts of the app would otherwise each need this feature.",
    expectedTouch: ["shared layer", "all affected consumers", "tests"],
  }),
];

const REFACTOR_TEMPLATES: Template[] = [
  () => ({
    name: "Incremental refactor",
    approach: "Refactor one seam at a time, keeping behavior identical and running checks after each step.",
    pros: ["Safest", "Easy to bisect if something breaks"],
    cons: ["Slower", "Intermediate states may look inconsistent"],
    risk: "low",
    effort: "medium",
    whenToChoose: "When the code is risky or poorly covered by tests.",
    expectedTouch: ["one module per step", "no behavior change"],
  }),
  () => ({
    name: "Consolidated refactor",
    approach: "Restructure the target area in one pass with its tests updated alongside.",
    pros: ["One coherent result"],
    cons: ["Large diff to review at once"],
    risk: "medium",
    effort: "large",
    whenToChoose: "When the area is well covered by tests.",
    expectedTouch: ["the whole target area", "its tests"],
  }),
  () => ({
    name: "Extract shared primitives",
    approach: "Identify the repeated pattern inside the target and extract it into shared utilities/components first, then simplify call sites.",
    pros: ["Reduces duplication durably"],
    cons: ["Touches every call site of the pattern"],
    risk: "medium",
    effort: "large",
    whenToChoose: "When duplication is the main problem.",
    expectedTouch: ["new shared primitive", "all call sites", "tests"],
  }),
];

const GENERIC_TEMPLATES: Template[] = [
  ({ target }) => ({
    name: "Minimal scoped change",
    approach: `Make the smallest change that satisfies "${target}" and nothing more.`,
    pros: ["Lowest risk", "Fast"],
    cons: ["May need follow-up work"],
    risk: "low",
    effort: "small",
    whenToChoose: "Default for small or unclear requests.",
    expectedTouch: ["the most relevant file", "its tests"],
  }),
  ({ target }) => ({
    name: "Structured change with tests",
    approach: `Implement "${target}" with explicit acceptance criteria, updates to affected tests, and checks run before reporting.`,
    pros: ["Verifiable result"],
    cons: ["More upfront effort"],
    risk: "medium",
    effort: "medium",
    whenToChoose: "When correctness matters more than speed.",
    expectedTouch: ["implementation files", "tests", "docs if public behavior changes"],
  }),
  () => ({
    name: "Spike first, then implement",
    approach: "Prove the risky part in a throwaway experiment, then implement for real using what was learned.",
    pros: ["De-risks unknowns before committing"],
    cons: ["Two-phase effort"],
    risk: "medium",
    effort: "large",
    whenToChoose: "When feasibility is genuinely uncertain.",
    expectedTouch: ["spike (discarded)", "then implementation files", "tests"],
  }),
];

/** Produce distinct implementation approaches with real trade-offs. */
export function generateOptions(
  request: string,
  inspection?: ProjectInspection,
  expansion?: IntentExpansion,
  count = 3
): OptionSet {
  const category = expansion?.taskCategory ?? "unknown";
  const templates =
    category === "ui"
      ? UI_TEMPLATES
      : category === "fix"
        ? FIX_TEMPLATES
        : category === "feature"
          ? FEATURE_TEMPLATES
          : category === "refactor"
            ? REFACTOR_TEMPLATES
            : GENERIC_TEMPLATES;

  const stack = inspection
    ? [...inspection.detectedStack, ...inspection.frameworks].join(", ") || "the existing stack"
    : "the existing stack";
  const target = expansion?.mentionedPaths[0] ?? request.trim().slice(0, 80);
  const hasExisting =
    (inspection?.structure.fileCount ?? 0) > 0 && category !== "unknown";

  const options: ImplementationOption[] = templates.slice(0, Math.max(1, count)).map((t, i) => ({
    id: `opt-${i + 1}`,
    ...t({ stack, target, hasExisting }),
  }));

  const recommendation = options[0].id;
  const decisionQuestion =
    category === "ui"
      ? "Which visual direction should the implementation take?"
      : category === "fix"
        ? "Should the fix stay local or address the root cause?"
        : category === "feature"
          ? "Should the feature live in existing code, a new module, or the shared layer?"
          : category === "refactor"
            ? "How aggressive should the restructuring be?"
            : "How broad should the change be?";

  return {
    taskCategory: category,
    options,
    recommendation,
    decisionNeeded: options.length > 1,
    decisionQuestion,
  };
}
