import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AGENT_WORKFLOW } from "./resources.js";

function userMessage(text: string) {
  return {
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text },
      },
    ],
  };
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "feature-development",
    {
      title: "Feature development",
      description: "Guided workflow for turning a feature request into a bounded, verified implementation.",
      argsSchema: {
        request: z.string().describe("The feature request in the user's own words."),
      },
    },
    ({ request }) =>
      userMessage(
        `${AGENT_WORKFLOW}\n\n## Task\n${request}\n\n` +
          `Start with inspect_project and expand_intent. Resolve blocking open questions with the user before implementing.`
      )
  );

  server.registerPrompt(
    "bug-fix",
    {
      title: "Bug fix",
      description: "Guided workflow for reproducing, fixing, and regression-testing a bug.",
      argsSchema: {
        request: z.string().describe("The bug report: what happens, what was expected, how to reproduce."),
      },
    },
    ({ request }) =>
      userMessage(
        `${AGENT_WORKFLOW}\n\n## Bug report\n${request}\n\n` +
          `Before changing anything: reproduce the failure and record the exact error. Prefer the root-cause fix option and add a regression test that fails before the fix and passes after.`
      )
  );

  server.registerPrompt(
    "ui-change",
    {
      title: "UI change",
      description: "Guided workflow for visual/UI changes with explicit design direction and preserved behavior.",
      argsSchema: {
        request: z.string().describe("The UI change request."),
      },
    },
    ({ request }) =>
      userMessage(
        `${AGENT_WORKFLOW}\n\n## UI request\n${request}\n\n` +
          `Visual direction is a real decision: run generate_options and present the options to the user before implementing. Preserve routes, callbacks, accessibility, and responsive behavior unless the task says otherwise.`
      )
  );

  server.registerPrompt(
    "refactor",
    {
      title: "Refactor",
      description: "Guided workflow for behavior-preserving restructuring with continuous verification.",
      argsSchema: {
        request: z.string().describe("What should be refactored and why."),
      },
    },
    ({ request }) =>
      userMessage(
        `${AGENT_WORKFLOW}\n\n## Refactor request\n${request}\n\n` +
          `Behavior must stay identical. Run the project's checks before starting to establish a green baseline, then re-run after each step.`
      )
  );

  server.registerPrompt(
    "code-review",
    {
      title: "Code review",
      description: "Review current changes against a saved task specification with evidence-based verdicts.",
      argsSchema: {
        specId: z.string().describe("TaskSpec id saved under .promptpilot/specs/."),
      },
    },
    ({ specId }) =>
      userMessage(
        `Review the current working tree against task spec "${specId}".\n\n` +
          `1. Run review_implementation with runChecks=true.\n` +
          `2. Report: what changed, which files were affected, which checks passed/failed with evidence, which acceptance criteria remain unverified, and any scope violations.\n` +
          `3. Never claim success without evidence.`
      )
  );
}
