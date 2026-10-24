import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { ProjectInspection } from "./project.js";
import type { IntentExpansion } from "./intent.js";
import type { OptionSet, ImplementationOption } from "./options.js";

export const TASK_SPEC_VERSION = "1.0";

export const RequirementSchema = z.object({
  text: z.string().min(1),
  source: z.enum(["stated", "inferred", "accepted"]),
  confidence: z.enum(["high", "medium", "low"]).default("high"),
});

export const AcceptanceCriterionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  check: z.string().min(1),
});

export const ChangeScopeSchema = z.object({
  allowedFiles: z.array(z.string()).min(1),
  protectedPaths: z.array(z.string()).default([]),
  allowedCategories: z.array(z.string()).default([]),
  requiresApproval: z
    .array(
      z.enum([
        "dependency-change",
        "database-migration",
        "auth-or-config",
        "public-api-change",
        "file-deletion",
      ])
    )
    .default(["dependency-change", "database-migration", "auth-or-config", "file-deletion"]),
});

export const VerificationSchema = z.object({
  commands: z.array(
    z.object({
      label: z.string(),
      command: z.string().min(1),
      timeoutMs: z.number().int().positive().default(300_000),
    })
  ),
  notes: z.array(z.string()).default([]),
});

export const PolicySchema = z.object({
  destructiveActionsAllowed: z.literal(false).default(false),
  preserveDirtyWorkingTree: z.boolean().default(true),
  maxFixRetries: z.number().int().min(0).max(5).default(2),
  note: z.string().optional(),
});

export const TaskSpecSchema = z.object({
  schemaVersion: z.literal(TASK_SPEC_VERSION),
  id: z.string().min(1),
  title: z.string().min(1),
  request: z.string().min(1),
  createdAt: z.string().min(1),
  projectRoot: z.string().min(1),
  taskCategory: z.string().min(1),
  requirements: z.array(RequirementSchema).min(1),
  nonGoals: z.array(z.string()).default([]),
  assumptions: z.array(z.object({ assumption: z.string(), verifyBy: z.string() })).default([]),
  openQuestions: z
    .array(
      z.object({
        question: z.string(),
        reason: z.string(),
        suggestedOptions: z.array(z.string()).default([]),
        blocking: z.boolean().default(false),
      })
    )
    .default([]),
  chosenOption: z
    .object({
      id: z.string(),
      name: z.string(),
      approach: z.string(),
      risk: z.string(),
      effort: z.string(),
    })
    .optional(),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1),
  changeScope: ChangeScopeSchema,
  verification: VerificationSchema,
  policy: PolicySchema,
  status: z.enum(["draft", "approved", "in-progress", "done"]).default("draft"),
});

export type TaskSpec = z.infer<typeof TaskSpecSchema>;

export interface CreateSpecInput {
  request: string;
  root: string;
  inspection?: ProjectInspection;
  expansion?: IntentExpansion;
  options?: OptionSet;
  chosenOptionId?: string;
  title?: string;
  nonGoals?: string[];
  extraAllowedFiles?: string[];
  extraProtectedPaths?: string[];
  verificationCommands?: Array<{ label: string; command: string; timeoutMs?: number }>;
  save?: boolean;
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "task"
  );
}

/** Auto-detect verification commands from package.json scripts / known tooling. */
export function detectVerificationCommands(
  inspection?: ProjectInspection,
  root?: string
): Array<{ label: string; command: string; timeoutMs: number }> {
  let scripts: Record<string, string> = inspection?.scripts ?? {};
  if (Object.keys(scripts).length === 0 && root) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      };
      scripts = pkg.scripts ?? {};
    } catch {
      /* no package.json readable — fall through with empty scripts */
    }
  }
  const out: Array<{ label: string; command: string; timeoutMs: number }> = [];
  const pick = (name: string, label: string) => {
    if (scripts[name]) out.push({ label, command: `npm run ${name}`, timeoutMs: 300_000 });
  };
  pick("typecheck", "typecheck");
  pick("type-check", "typecheck");
  pick("lint", "lint");
  pick("test", "test");
  pick("build", "build");

  if (root) {
    const hasPytest = fs.existsSync(path.join(root, "pytest.ini")) || fs.existsSync(path.join(root, "pyproject.toml"));
    if (hasPytest && !scripts.test) out.push({ label: "pytest", command: "pytest -q", timeoutMs: 300_000 });
    if (fs.existsSync(path.join(root, "go.mod")) && !scripts.test) {
      out.push({ label: "go test", command: "go test ./...", timeoutMs: 300_000 });
    }
  }
  return out;
}

/** Assemble a validated TaskSpec from an intent expansion (+ optional chosen option). */
export function createTaskSpec(input: CreateSpecInput): { spec: TaskSpec; savedPath: string | null } {
  const expansion = input.expansion;
  const options = input.options;

  const chosen: ImplementationOption | undefined = input.chosenOptionId
    ? options?.options.find((o) => o.id === input.chosenOptionId)
    : options?.options.find((o) => o.id === options.recommendation);

  const requirements = expansion
    ? [
        ...expansion.statedRequirements.map((r) => ({ ...r, source: "stated" as const })),
        ...expansion.inferredRequirements.map((r) => ({ ...r, source: "inferred" as const })),
      ]
    : [{ text: input.request, source: "stated" as const, confidence: "high" as const }];

  const acceptance = expansion
    ? expansion.acceptanceCriteriaDraft
    : [
        { id: "AC-1", text: "The request is implemented as specified.", check: "manual-review" },
        { id: "AC-2", text: "No files outside the agreed change scope were modified.", check: "check_change_scope" },
        { id: "AC-3", text: "All applicable project checks pass or their absence is reported.", check: "verify_implementation" },
      ];

  const touchGlobs = (chosen?.expectedTouch ?? [])
    .map((t) => t.trim().replace(/^the\s+/i, ""))
    .filter((t) => !/\s/.test(t) && (/\.[a-z0-9]+$/i.test(t) || t.includes("/") || t.includes("*")))
    .map((t) => (t.includes("*") || t.includes("/") ? t : `**/${t}`));
  const allowed = [
    ...(input.extraAllowedFiles ?? []),
    ...(input.expansion?.mentionedPaths ?? []),
    ...touchGlobs,
  ];
  const allowedFiles = allowed.length > 0 ? Array.from(new Set(allowed)) : ["src/**", "app/**", "lib/**", "tests/**", "test/**"];

  const verificationCommands =
    input.verificationCommands?.map((c) => ({
      label: c.label,
      command: c.command,
      timeoutMs: c.timeoutMs ?? 300_000,
    })) ?? detectVerificationCommands(input.inspection, input.root);

  const spec: TaskSpec = TaskSpecSchema.parse({
    schemaVersion: TASK_SPEC_VERSION,
    id: `${slugify(input.title ?? input.request)}-${Date.now().toString(36)}`,
    title: input.title ?? expansion?.restatedGoal ?? input.request.trim().slice(0, 100),
    request: input.request,
    createdAt: new Date().toISOString(),
    projectRoot: path.resolve(input.root).replace(/\\/g, "/"),
    taskCategory: expansion?.taskCategory ?? "unknown",
    requirements,
    nonGoals: input.nonGoals ?? [
      "No unrelated refactoring",
      "No dependency or configuration changes unless required by the task",
      "No changes to pre-existing uncommitted user work",
    ],
    assumptions: expansion?.assumptions ?? [],
    openQuestions: expansion?.openQuestions ?? [],
    chosenOption: chosen
      ? { id: chosen.id, name: chosen.name, approach: chosen.approach, risk: chosen.risk, effort: chosen.effort }
      : undefined,
    acceptanceCriteria: acceptance,
    changeScope: {
      allowedFiles,
      protectedPaths: Array.from(
        new Set([".git/**", ".env", ".env.*", "**/*.pem", "**/*.key", ...(input.extraProtectedPaths ?? [])])
      ),
      allowedCategories: [],
      requiresApproval: ["dependency-change", "database-migration", "auth-or-config", "file-deletion"],
    },
    verification: {
      commands: verificationCommands,
      notes:
        verificationCommands.length === 0
          ? ["No lint/test/build commands were detected in this project; report checks as not available."]
          : [],
    },
    policy: {
      destructiveActionsAllowed: false,
      preserveDirtyWorkingTree: true,
      maxFixRetries: 2,
    },
    status: "draft",
  });

  let savedPath: string | null = null;
  if (input.save !== false) {
    savedPath = saveTaskSpec(spec);
  }
  return { spec, savedPath };
}

export function specDir(root: string): string {
  return path.join(path.resolve(root), ".promptpilot", "specs");
}

export function saveTaskSpec(spec: TaskSpec): string {
  const dir = specDir(spec.projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  // PromptPilot's own state must not appear as task changes in Git.
  const ignoreFile = path.join(path.resolve(spec.projectRoot), ".promptpilot", ".gitignore");
  if (!fs.existsSync(ignoreFile)) fs.writeFileSync(ignoreFile, "*\n", "utf8");
  const file = path.join(dir, `${spec.id}.json`);
  fs.writeFileSync(file, JSON.stringify(spec, null, 2), "utf8");
  return file.replace(/\\/g, "/");
}

export function loadTaskSpec(root: string, id: string): TaskSpec {
  const file = path.join(specDir(root), `${id}.json`);
  if (!fs.existsSync(file)) {
    const available = listTaskSpecs(root);
    throw new Error(
      `Task spec "${id}" not found in .promptpilot/specs/.${available.length ? ` Available: ${available.join(", ")}` : ""}`
    );
  }
  return TaskSpecSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function listTaskSpecs(root: string): string[] {
  const dir = specDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}
