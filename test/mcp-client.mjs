/**
 * PromptPilot integration test: a real MCP client talking to the built server
 * over stdio, exercising the full lifecycle on a throwaway Git project.
 *
 * Run: npm run test:node   (builds dist/, then runs this with node)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(here, "..", "dist", "index.js");

let failures = 0;
function check(name, cond, detail = "") {
  const ok = Boolean(cond);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

// --- fixture project ---
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "pp-mcp-"));
fs.mkdirSync(path.join(fixture, "src"), { recursive: true });
fs.writeFileSync(
  path.join(fixture, "package.json"),
  JSON.stringify(
    {
      name: "mcp-fixture",
      scripts: { test: "node -e \"process.exit(0)\"", lint: "node -e \"process.exit(0)\"" },
      dependencies: { react: "19.0.0" },
    },
    null,
    2
  )
);
fs.writeFileSync(path.join(fixture, "AGENTS.md"), "# Agents\nKeep changes minimal.\n");
fs.writeFileSync(path.join(fixture, "src", "app.js"), "export const app = () => 'v1';\n");
git(fixture, ["init", "-b", "main"]);
git(fixture, ["config", "user.email", "t@t"]);
git(fixture, ["config", "user.name", "t"]);
git(fixture, ["add", "."]);
git(fixture, ["commit", "-m", "init"]);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry, "--root", fixture],
  env: { ...process.env },
});
const client = new Client({ name: "promptpilot-integration-test", version: "1.0.0" });
await client.connect(transport);

const parse = (res) => JSON.parse(res.content[0].text);

// --- capability surface ---
const tools = await client.listTools();
const toolNames = tools.tools.map((t) => t.name).sort();
console.log("tools:", toolNames.join(", "));
for (const expected of [
  "inspect_project", "expand_intent", "generate_options", "create_task_spec",
  "check_change_scope", "verify_implementation", "review_implementation",
  "get_project_context", "update_project_context", "record_baseline",
]) {
  check(`tool registered: ${expected}`, toolNames.includes(expected));
}

const resources = await client.listResources();
check("resources registered (3)", resources.resources.length === 3, JSON.stringify(resources.resources.map((r) => r.uri)));
const prompts = await client.listPrompts();
check(
  "prompts registered (5)",
  prompts.prompts.length === 5,
  prompts.prompts.map((p) => p.name).join(", ")
);

// --- lifecycle ---
const inspection = parse(await client.callTool({ name: "inspect_project", arguments: { root: fixture } }));
check("inspect_project detects npm manifest", inspection.manifests.some((m) => m.kind === "npm"));
check("inspect_project sees AGENTS.md", inspection.instructionFiles.some((f) => f.file === "AGENTS.md"));
check("inspect_project detects react", inspection.frameworks.includes("react"));

const expansion = parse(
  await client.callTool({ name: "expand_intent", arguments: { request: "Make the app output look nice", root: fixture } })
);
check("expand_intent classifies ui task", expansion.taskCategory === "ui");
check("expand_intent raises open questions", expansion.openQuestions.length > 0);
check("expand_intent drafts acceptance criteria", expansion.acceptanceCriteriaDraft.length >= 4);

const optionSet = parse(
  await client.callTool({ name: "generate_options", arguments: { request: "Make the app output look nice", root: fixture } })
);
check("generate_options returns 3 options", optionSet.options.length === 3);
check("generate_options has trade-offs", optionSet.options.every((o) => o.pros.length > 0 && o.cons.length > 0));

const created = parse(
  await client.callTool({
    name: "create_task_spec",
    arguments: {
      request: "Make the app output look nice",
      root: fixture,
      title: "beautify app output",
      allowedFiles: ["src/app.js"],
    },
  })
);
check("create_task_spec returns a valid spec", created.spec.schemaVersion === "1.0" && created.spec.id.length > 0);
check("create_task_spec persisted to .promptpilot/specs", created.savedPath !== null && fs.existsSync(path.join(fixture, ".promptpilot", "specs", `${created.spec.id}.json`)));
check("create_task_spec warns about blocking questions", Array.isArray(created.unresolvedBlockingQuestions));

const baseline = parse(await client.callTool({ name: "record_baseline", arguments: { root: fixture } }));
check("record_baseline captures HEAD", typeof baseline.head === "string" && baseline.head.length === 40);

// implement the change in scope
fs.writeFileSync(path.join(fixture, "src", "app.js"), "export const app = () => 'v1 ✨';\n");

const scope = parse(
  await client.callTool({ name: "check_change_scope", arguments: { root: fixture, specId: created.spec.id } })
);
check("check_change_scope verdict within-scope", scope.verdict === "within-scope", JSON.stringify(scope.summary));
check("check_change_scope lists the changed file", scope.findings.some((f) => f.file === "src/app.js"));

const verify = parse(
  await client.callTool({ name: "verify_implementation", arguments: { root: fixture, specId: created.spec.id } })
);
check("verify_implementation ran real checks", verify.results.length >= 2, JSON.stringify(verify.results.map((r) => [r.label, r.status])));
check("verify_implementation overall passed", verify.overall === "passed");
check("verify_implementation keeps evidence", verify.results.every((r) => r.evidence.includes("exit code")));

const review = parse(
  await client.callTool({ name: "review_implementation", arguments: { root: fixture, specId: created.spec.id, runChecks: true } })
);
check("review verdict ready-for-human-review", review.verdict === "ready-for-human-review", review.summary);
check("review marks semantic criteria unverified", review.unverified.length > 0);
check("review scope criterion evidence-pass", review.criteria.some((c) => c.check === "check_change_scope" && c.status === "evidence-pass"));

// now break the scope on purpose
fs.writeFileSync(path.join(fixture, "src", "unrelated.js"), "export {};\n");
const scope2 = parse(
  await client.callTool({ name: "check_change_scope", arguments: { root: fixture, specId: created.spec.id } })
);
check("check_change_scope flags out-of-scope file", scope2.verdict === "scope-violation", JSON.stringify(scope2.summary));

// context store
const ctxUpdate = parse(
  await client.callTool({
    name: "update_project_context",
    arguments: {
      root: fixture,
      architecture: "Single-module ESM app",
      conventions: ["Named exports only"],
      commands: { test: "npm test" },
      decision: { decision: "Keep app.js as the only entry", reason: "Fixture scope" },
      changeNote: "integration test",
    },
  })
);
check("update_project_context stores decisions", ctxUpdate.profile.decisions.length === 1);
const ctxGet = parse(await client.callTool({ name: "get_project_context", arguments: { root: fixture } }));
check("get_project_context round-trips", ctxGet.context.profile.architecture === "Single-module ESM app");
check("get_project_context reports freshness", typeof ctxGet.freshness.fresh === "boolean");

// error handling surfaces as isError, not a crash
const bad = await client.callTool({ name: "review_implementation", arguments: { root: fixture, specId: "does-not-exist" } });
check("unknown specId returns isError", bad.isError === true);

// resources readable
const wf = await client.readResource({ uri: "promptpilot://agent-workflow" });
check("agent-workflow resource readable", wf.contents[0].text.includes("PromptPilot implementation workflow"));

await client.close();
fs.rmSync(fixture, { recursive: true, force: true });

console.log(failures === 0 ? "\nALL INTEGRATION CHECKS PASSED" : `\n${failures} INTEGRATION CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
