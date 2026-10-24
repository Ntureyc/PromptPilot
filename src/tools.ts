import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { inspectProject } from "./lib/project.js";
import { expandIntent } from "./lib/intent.js";
import { generateOptions } from "./lib/options.js";
import {
  createTaskSpec,
  loadTaskSpec,
  listTaskSpecs,
  detectVerificationCommands,
  ChangeScopeSchema,
} from "./lib/spec.js";
import { checkChangeScope } from "./lib/policy.js";
import { runVerification, verifyImplementation } from "./lib/verify.js";
import { reviewImplementation } from "./lib/review.js";
import { getProjectContext, updateProjectContext } from "./lib/context.js";
import { takeBaseline } from "./lib/git.js";

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

const rootField = z
  .string()
  .optional()
  .describe("Project root directory. Defaults to the MCP client's current working directory.");

export function registerTools(server: McpServer, defaultRoot: string): void {
  const rootOf = (r?: string) => r ?? defaultRoot;

  server.registerTool(
    "inspect_project",
    {
      title: "Inspect project",
      description:
        "Discover project structure, manifests, stack, instruction files (AGENTS.md/CLAUDE.md/README), and current Git status. Run this before planning any non-trivial change.",
      inputSchema: { root: rootField },
    },
    async ({ root }) => {
      try {
        return jsonResult(inspectProject(rootOf(root)));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "expand_intent",
    {
      title: "Expand intent",
      description:
        "Convert a vague request into explicit requirements (stated vs inferred), assumptions, open questions, a risk level, and an acceptance-criteria draft.",
      inputSchema: {
        request: z.string().min(1).describe("The natural-language request, as the user wrote it."),
        root: rootField,
        useProject: z
          .boolean()
          .optional()
          .describe("Inspect the project first to ground inferred requirements (default true)."),
      },
    },
    async ({ root, request, useProject }) => {
      try {
        const inspection = useProject === false ? undefined : inspectProject(rootOf(root));
        return jsonResult(expandIntent(request, inspection));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "generate_options",
    {
      title: "Generate options",
      description:
        "Produce 2-3 distinct implementation approaches with real trade-offs (pros, cons, risk, effort, expected files). Use when the choice genuinely matters; skip for trivial changes.",
      inputSchema: {
        request: z.string().min(1).describe("The natural-language request."),
        root: rootField,
        count: z.number().int().min(2).max(3).optional().describe("How many options to produce (2-3)."),
      },
    },
    async ({ root, request, count }) => {
      try {
        const inspection = inspectProject(rootOf(root));
        const expansion = expandIntent(request, inspection);
        return jsonResult(generateOptions(request, inspection, expansion, count ?? 3));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "create_task_spec",
    {
      title: "Create task specification",
      description:
        "Build a validated TaskSpec v1.0: requirements, non-goals, assumptions, open questions, chosen option, acceptance criteria, change boundaries, verification commands, and safety policy. Saved to .promptpilot/specs/ unless save=false.",
      inputSchema: {
        request: z.string().min(1).describe("The natural-language request."),
        root: rootField,
        title: z.string().optional().describe("Optional short title; derived from the request when omitted."),
        chosenOptionId: z.string().optional().describe("Option id from generate_options to lock in."),
        nonGoals: z.array(z.string()).optional().describe("Explicit non-goals for this task."),
        allowedFiles: z.array(z.string()).optional().describe("Extra globs to allow, e.g. \"src/components/Header.tsx\" or \"src/**\"."),
        protectedPaths: z.array(z.string()).optional().describe("Globs that must never change."),
        verificationCommands: z
          .array(
            z.object({
              label: z.string(),
              command: z.string(),
              timeoutMs: z.number().int().positive().optional(),
            })
          )
          .optional()
          .describe("Override auto-detected lint/test/build commands."),
        save: z.boolean().optional().describe("Persist to .promptpilot/specs/ (default true)."),
      },
    },
    async ({ root, request, title, chosenOptionId, nonGoals, allowedFiles, protectedPaths, verificationCommands, save }) => {
      try {
        const rootPath = rootOf(root);
        const inspection = inspectProject(rootPath);
        const expansion = expandIntent(request, inspection);
        const options = generateOptions(request, inspection, expansion, 3);
        const { spec, savedPath } = createTaskSpec({
          request,
          root: rootPath,
          inspection,
          expansion,
          options,
          chosenOptionId,
          title,
          nonGoals,
          extraAllowedFiles: allowedFiles,
          extraProtectedPaths: protectedPaths,
          verificationCommands,
          save,
        });
        return jsonResult({ spec, savedPath, unresolvedBlockingQuestions: spec.openQuestions.filter((q) => q.blocking) });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "check_change_scope",
    {
      title: "Check change scope",
      description:
        "Compare the current Git changes (or provided files) against the approved boundaries. Flags out-of-scope files, protected paths, dependency changes, migrations, auth/config edits, deletions, and touched pre-existing user changes.",
      inputSchema: {
        root: rootField,
        specId: z.string().optional().describe("TaskSpec id saved under .promptpilot/specs/."),
        allowedFiles: z.array(z.string()).optional().describe("Allowed globs when no specId is given."),
        protectedPaths: z.array(z.string()).optional().describe("Protected globs when no specId is given."),
        files: z
          .array(z.object({ path: z.string(), status: z.string() }))
          .optional()
          .describe("Explicit file changes to check instead of reading Git status."),
      },
    },
    async ({ root, specId, allowedFiles, protectedPaths, files }) => {
      try {
        const rootPath = rootOf(root);
        let changeScope;
        if (specId) {
          changeScope = loadTaskSpec(rootPath, specId).changeScope;
        } else {
          changeScope = ChangeScopeSchema.parse({
            allowedFiles: allowedFiles && allowedFiles.length > 0 ? allowedFiles : ["src/**", "app/**", "lib/**", "tests/**", "test/**"],
            protectedPaths: protectedPaths ?? [".git/**", ".env", ".env.*", "**/*.pem", "**/*.key"],
          });
        }
        return jsonResult(checkChangeScope({ changeScope }, rootPath, { files }));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "verify_implementation",
    {
      title: "Verify implementation",
      description:
        "Run lint/typecheck/test/build commands and return real evidence (exit code, duration, output). Uses the spec's commands, explicit commands, or auto-detected project scripts. Never fabricates results — absent checks are reported as such.",
      inputSchema: {
        root: rootField,
        specId: z.string().optional().describe("TaskSpec id whose verification commands should run."),
        commands: z
          .array(
            z.object({
              label: z.string(),
              command: z.string(),
              timeoutMs: z.number().int().positive().optional(),
            })
          )
          .optional()
          .describe("Explicit commands to run instead of the spec's or auto-detected ones."),
      },
    },
    async ({ root, specId, commands }) => {
      try {
        const rootPath = rootOf(root);
        if (commands && commands.length > 0) {
          return jsonResult(runVerification(rootPath, commands));
        }
        if (specId) {
          return jsonResult(verifyImplementation(loadTaskSpec(rootPath, specId), rootPath));
        }
        const inspection = inspectProject(rootPath);
        return jsonResult(runVerification(rootPath, detectVerificationCommands(inspection, rootPath)));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "review_implementation",
    {
      title: "Review implementation",
      description:
        "Evaluate the current changes against a saved TaskSpec: scope compliance, check evidence, per-criterion assessment, risks, and explicitly unverified items. Returns a verdict of ready-for-human-review, needs-changes, or blocked.",
      inputSchema: {
        root: rootField,
        specId: z.string().describe("TaskSpec id saved under .promptpilot/specs/."),
        runChecks: z.boolean().optional().describe("Also run the spec's verification commands (default false)."),
      },
    },
    async ({ root, specId, runChecks }) => {
      try {
        const rootPath = rootOf(root);
        const spec = loadTaskSpec(rootPath, specId);
        return jsonResult(reviewImplementation(spec, rootPath, { runChecks: runChecks === true }));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "get_project_context",
    {
      title: "Get project context",
      description:
        "Retrieve the persistent project profile (architecture, conventions, commands, design rules, constraints, decisions) plus freshness info showing which key files changed since it was last verified.",
      inputSchema: { root: rootField },
    },
    async ({ root }) => {
      try {
        return jsonResult(getProjectContext(rootOf(root)));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "update_project_context",
    {
      title: "Update project context",
      description:
        "Record verified project knowledge (architecture, conventions, commands, design rules, constraints, decisions) into .promptpilot/context.json. Only record facts you have verified, never guesses.",
      inputSchema: {
        root: rootField,
        architecture: z.string().optional(),
        conventions: z.array(z.string()).optional(),
        commands: z.record(z.string(), z.string()).optional().describe("Command name -> invocation, e.g. {\"test\": \"npm test\"}."),
        designRules: z.array(z.string()).optional(),
        constraints: z.array(z.string()).optional(),
        knownRisks: z.array(z.string()).optional(),
        decision: z
          .object({ decision: z.string(), reason: z.string() })
          .optional()
          .describe("A verified decision to remember, with its reason."),
        changeNote: z.string().optional().describe("One-line note for the context history."),
      },
    },
    async ({ root, architecture, conventions, commands, designRules, constraints, knownRisks, decision, changeNote }) => {
      try {
        const ctx = updateProjectContext(rootOf(root), {
          architecture,
          conventions,
          commands,
          designRules,
          constraints,
          knownRisks,
          decision: decision ? { ...decision, recordedAt: new Date().toISOString() } : undefined,
          changeNote,
        });
        return jsonResult(ctx);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // Baseline helper used by the documented execution lifecycle.
  server.registerTool(
    "record_baseline",
    {
      title: "Record baseline",
      description:
        "Snapshot the current Git state (HEAD + dirty files) before implementation starts, so pre-existing user changes can be preserved and distinguished from task changes.",
      inputSchema: { root: rootField },
    },
    async ({ root }) => {
      try {
        return jsonResult(takeBaseline(rootOf(root)));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  void listTaskSpecs; // keep listTaskSpecs imported for resources module symmetry
}
