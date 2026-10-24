import type { ProjectInspection } from "./project.js";

export interface Requirement {
  text: string;
  source: "stated" | "inferred";
  confidence: "high" | "medium" | "low";
}

export interface OpenQuestion {
  question: string;
  reason: string;
  suggestedOptions: string[];
  blocking: boolean;
}

export interface AcceptanceCriterion {
  id: string;
  text: string;
  check: string;
}

export interface IntentExpansion {
  request: string;
  restatedGoal: string;
  taskCategory: "feature" | "fix" | "refactor" | "ui" | "testing" | "docs" | "migration" | "removal" | "unknown";
  statedRequirements: Requirement[];
  inferredRequirements: Requirement[];
  assumptions: Array<{ assumption: string; verifyBy: string }>;
  openQuestions: OpenQuestion[];
  acceptanceCriteriaDraft: AcceptanceCriterion[];
  riskLevel: "low" | "medium" | "high";
  riskReasons: string[];
  mentionedPaths: string[];
  mentionedTechnologies: string[];
  suggestedScopeHints: string[];
}

const VAGUE_TERMS: Array<[string, string, string[]]> = [
  [
    "nice|look nice|looks nice|pretty|beautiful|modern|clean|sleek|polished",
    "Visual direction is not defined for this project.",
    ["Minimal and refined (match existing design tokens)", "Translucent / layered surfaces", "Bold hierarchy with prominent calls to action"],
  ],
  [
    "better|improve|improve it|upgrade|optimize|faster|performance",
    "The target metric or current deficiency is not stated.",
    ["Keep current behavior, improve readability/structure", "Improve measurable performance (name the metric)", "Redesign the approach entirely"],
  ],
  [
    "user-friendly|easy to use|intuitive|smooth|responsive",
    "Quality attribute has no observable definition.",
    ["Mobile-first responsive behavior", "Compact layout at all sizes", "Preserve existing responsive behavior"],
  ],
  [
    "robust|reliable|stable|production-ready|secure",
    "Non-functional bar is not defined.",
    ["Add input validation and error handling only", "Add validation plus tests for failure paths", "Full hardening incl. logging and rate limits"],
  ],
  [
    "somehow|etc|and so on|whatever|stuff|things|something",
    "Filler wording hides the concrete requirement.",
    ["State the concrete behavior expected", "Keep current behavior for unspecified cases", "Ask the user to name the exact items"],
  ],
  [
    "nice design",
    "Visual direction is not defined for this project.",
    ["Minimal and refined", "Translucent and modern", "Bold and prominent"],
  ],
];

const HIGH_RISK_TERMS =
  /\b(auth|authentication|login|session|token|payment|billing|migration|migrate|database|schema|deploy|production|delete|remove|drop|security|permission|role|encrypt|secret|credential|firewall)\b/i;
const MED_RISK_TERMS =
  /\b(api|route|endpoint|state|hook|cache|config|env|dependency|package|refactor|rewrite|restructure)\b/i;

function detectCategory(request: string): IntentExpansion["taskCategory"] {
  const r = request.toLowerCase();
  if (/\b(fix|bug|broken|error|crash|issue|wrong)\b/.test(r)) return "fix";
  if (/\b(refactor|clean up|cleanup|restructure|reorganize|simplif)\w*/.test(r)) return "refactor";
  if (/\b(migrate|migration|upgrade.*version|move to)\b/.test(r)) return "migration";
  if (/\b(remove|delete|drop|strip)\b/.test(r)) return "removal";
  if (/\b(test|coverage|spec)\b/.test(r)) return "testing";
  if (/\b(doc|readme|guide|comment)\b/.test(r)) return "docs";
  if (
    /\b(ui|navbar|navigation|header|footer|button|modal|dialog|page|screen|style|css|design|layout|component|form|card|menu|theme|dark mode|dashboard|appearance|beautiful|pretty|stylish|aesthetic|looks?)\b/.test(
      r
    )
  )
    return "ui";
  if (/\b(build|add|create|implement|make|support|feature|integrat)\w*/.test(r)) return "feature";
  return "unknown";
}

function splitSentences(request: string): string[] {
  return request
    .split(/(?<=[.!?;])\s+|\n+|,\s*(?=\band\b|\bthen\b)/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

const KNOWN_TECH = [
  "react", "next.js", "nextjs", "vue", "svelte", "tailwind", "prisma", "typescript",
  "express", "fastapi", "flask", "django", "postgres", "mysql", "sqlite", "mongodb",
  "graphql", "rest", "docker", "kubernetes", "bun", "node", "python", "go", "rust",
  "shadcn", "radix", "vite", "jest", "vitest", "playwright",
];

function findPaths(request: string): string[] {
  const re = /(?:[\w.@-]+\/)+[\w.@-]+|\b[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|css|html|json|md|yml|yaml)\b/g;
  return Array.from(new Set(request.match(re) ?? []));
}

/** Convert a vague request into explicit requirements, assumptions, and open questions. */
export function expandIntent(
  request: string,
  inspection?: ProjectInspection
): IntentExpansion {
  const category = detectCategory(request);
  const sentences = splitSentences(request);

  const stated: Requirement[] = sentences.map((s) => ({
    text: s,
    source: "stated",
    confidence: "high",
  }));

  // Vague-term detection drives open questions.
  const openQuestions: OpenQuestion[] = [];
  for (const [pattern, reason, options] of VAGUE_TERMS) {
    const re = new RegExp(`\\b(${pattern})\\b`, "i");
    if (re.test(request) && !openQuestions.some((q) => q.reason === reason)) {
      openQuestions.push({
        question: `What does the request's wording ("${(request.match(re)?.[0] ?? "").trim()}") mean concretely here?`,
        reason,
        suggestedOptions: options,
        blocking: category === "ui" || pattern.includes("nice"),
      });
    }
  }

  const inferred: Requirement[] = [];
  const assumptions: IntentExpansion["assumptions"] = [];
  const scopeHints: string[] = [];

  if (inspection) {
    const stack = [...inspection.detectedStack, ...inspection.frameworks];
    if (stack.length > 0) {
      inferred.push({
        text: `Match the existing project stack and conventions (${stack.join(", ")}); do not introduce a parallel framework or styling system.`,
        source: "inferred",
        confidence: "high",
      });
    }
    if (inspection.frameworks.includes("tailwindcss")) {
      inferred.push({
        text: "Use the existing Tailwind design tokens/classes instead of one-off CSS.",
        source: "inferred",
        confidence: "high",
      });
    }
    if (inspection.instructionFiles.length > 0) {
      inferred.push({
        text: `Follow project instruction files (${inspection.instructionFiles.map((f) => f.file).join(", ")}).`,
        source: "inferred",
        confidence: "high",
      });
    }
    if (inspection.git.isRepo && inspection.git.changedFiles.length > 0) {
      inferred.push({
        text: `Preserve the ${inspection.git.changedFiles.length} pre-existing uncommitted change(s) in the working tree.`,
        source: "inferred",
        confidence: "high",
      });
    }
    if (category === "ui" && inspection.frameworks.length > 0) {
      assumptions.push({
        assumption: `UI work should reuse the existing ${inspection.frameworks.join("/")} component patterns rather than generating standalone markup.`,
        verifyBy: "Locate the closest existing component and compare its structure before implementing.",
      });
      scopeHints.push("Modify the existing component where possible; touch shared styles only when required.");
    }
    if (inspection.scripts.test || inspection.scripts.lint || inspection.scripts.build) {
      const cmds = Object.keys(inspection.scripts).filter((k) =>
        /^(test|lint|typecheck|check|build)/.test(k)
      );
      if (cmds.length > 0) {
        inferred.push({
          text: `Run the project's existing checks (${cmds.map((c) => `npm run ${c}`).join(", ")}) before reporting completion.`,
          source: "inferred",
          confidence: "high",
        });
      }
    }
    scopeHints.push("Do not modify unrelated files, dependencies, or configuration unless the task requires it.");
  }

  if (!request.match(/[\w.-]+\.(ts|tsx|js|jsx|py|go|rs|css|html|json|md)\b/) && (category === "ui" || category === "feature")) {
    assumptions.push({
      assumption: "No specific target file was named in the request.",
      verifyBy: "Run inspect_project and identify the file(s) that own this behavior before editing.",
    });
  }

  // Risk classification
  let riskLevel: IntentExpansion["riskLevel"] = "low";
  const riskReasons: string[] = [];
  if (HIGH_RISK_TERMS.test(request)) {
    riskLevel = "high";
    riskReasons.push("Request touches auth, data, payments, security, deletion, or deployment wording.");
  } else if (MED_RISK_TERMS.test(request) || category === "refactor" || category === "migration") {
    riskLevel = "medium";
    riskReasons.push("Request affects shared code paths, APIs, or configuration.");
  }
  if (category === "migration" || category === "removal") {
    riskLevel = "high";
    riskReasons.push("Category involves migration or removal of existing behavior.");
  }

  // Acceptance criteria draft
  const ac: AcceptanceCriterion[] = [
    {
      id: "AC-1",
      text: `The request "${request.trim()}" is implemented as specified (stated requirements only).`,
      check: "manual-review",
    },
    ...stated.slice(0, 6).map((s, i) => ({
      id: `AC-${i + 2}`,
      text: `Stated requirement satisfied: ${s.text}`,
      check: "manual-review",
    })),
    {
      id: `AC-${stated.length + 2}`,
      text: "No files outside the agreed change scope were modified.",
      check: "check_change_scope",
    },
    {
      id: `AC-${stated.length + 3}`,
      text: "All applicable project checks (lint / typecheck / test / build) pass, or their absence is explicitly reported.",
      check: "verify_implementation",
    },
    {
      id: `AC-${stated.length + 4}`,
      text: "Pre-existing uncommitted user changes are preserved.",
      check: "check_change_scope",
    },
  ];

  return {
    request,
    restatedGoal: `${category === "unknown" ? "Implement" : category[0].toUpperCase() + category.slice(1)}: ${request.trim()}`,
    taskCategory: category,
    statedRequirements: stated,
    inferredRequirements: inferred,
    assumptions,
    openQuestions,
    acceptanceCriteriaDraft: ac,
    riskLevel,
    riskReasons,
    mentionedPaths: findPaths(request),
    mentionedTechnologies: Array.from(
      new Set(KNOWN_TECH.filter((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(request)))
    ),
    suggestedScopeHints: scopeHints,
  };
}
