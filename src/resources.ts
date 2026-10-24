import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getProjectContext } from "./lib/context.js";
import { listTaskSpecs, loadTaskSpec } from "./lib/spec.js";

export const AGENT_WORKFLOW = `# PromptPilot implementation workflow

Before implementing a non-trivial coding request:

1. inspect_project — read the project's instructions, stack, and current Git state.
2. expand_intent — separate what the user said from what must be inferred; surface blocking questions.
3. generate_options — only when the choice genuinely matters (skip for trivial changes).
4. create_task_spec — lock requirements, acceptance criteria, change boundaries, and verification commands.
5. record_baseline — snapshot the working tree so pre-existing user changes are protected.
6. Implement only the agreed scope.
7. check_change_scope — inspect the real diff for scope violations and risky changes.
8. verify_implementation — run lint/typecheck/test/build and keep the evidence.
9. review_implementation — evaluate acceptance criteria against evidence; report unverified items honestly.

Rules:
- Do not overwrite unrelated user changes.
- Do not claim tests or builds passed unless they actually ran.
- Do not silently expand task scope; ask when an expansion is material.
- Never perform destructive actions (deleting user data, force-pushing, resetting dirty trees).
- For small, low-risk changes, take a fast path: inspect_project + create_task_spec with defaults, then implement and verify.`;

export function registerResources(server: McpServer, defaultRoot: string): void {
  server.registerResource(
    "project-context",
    "promptpilot://project-context",
    {
      title: "Project context profile",
      description:
        "Persistent project profile (architecture, conventions, commands, decisions) with freshness information.",
      mimeType: "application/json",
    },
    async (uri) => {
      const data = getProjectContext(defaultRoot);
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerResource(
    "agent-workflow",
    "promptpilot://agent-workflow",
    {
      title: "Agent workflow instructions",
      description:
        "The recommended client-side workflow that tells a coding agent when and how to use PromptPilot's tools.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: AGENT_WORKFLOW }],
    })
  );

  server.registerResource(
    "task-specs",
    "promptpilot://task-specs",
    {
      title: "Saved task specifications",
      description: "All task specifications saved under .promptpilot/specs/ for this project.",
      mimeType: "application/json",
    },
    async (uri) => {
      const ids = listTaskSpecs(defaultRoot);
      const specs = ids.map((id) => loadTaskSpec(defaultRoot, id));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ count: specs.length, specs }, null, 2),
          },
        ],
      };
    }
  );
}
