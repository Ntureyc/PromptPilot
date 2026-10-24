# PromptPilot

**Turn vague prompts into reliable implementations.**

PromptPilot is a context-engineering and implementation-orchestration MCP server that sits between you and your coding agent. It takes requests like *"build a navigation bar that looks nice"* and turns them into **context-rich, bounded, verifiable engineering tasks** — grounded in the actual repository, with explicit change boundaries and real verification evidence.

It is **not** a prompt enhancer. It gathers context, resolves ambiguity, plans changes, enforces boundaries, and verifies the implementation.

```
Understand → Inspect → Clarify → Specify → Implement → Verify → Report
```

---

## Why

Users communicate intent in simple language. Coding agents need detailed requirements, project context, constraints, implementation plans, and verification criteria. Without that bridge, agents invent assumptions, rewrite unrelated files, and report "done" without evidence.

PromptPilot fixes that with a pipeline of small, composable MCP tools:

| Stage | Problem | PromptPilot tool |
|---|---|---|
| Understand | "looks nice" means nothing measurable | `expand_intent` |
| Inspect | Agents ignore the project's real stack and rules | `inspect_project` |
| Clarify | Hidden choices silently get made for you | `generate_options` |
| Specify | Requirements drift during implementation | `create_task_spec` |
| Guard | One feature breaks three unrelated files | `check_change_scope` |
| Verify | "Tests pass" claimed without tests running | `verify_implementation` |
| Report | Success is asserted, not evidenced | `review_implementation` |

## Features

- **Automatic context discovery** — manifests, stack/framework detection, `AGENTS.md`/`CLAUDE.md`/`README.md`, project scripts, structure, and live Git status.
- **Intent expansion** — separates *stated* requirements from *inferred* ones, lists assumptions (each with how to verify it), surfaces vague wording as open questions with concrete options, drafts acceptance criteria, and classifies risk.
- **Implementation options** — 2–3 genuinely distinct approaches (minimal / overhaul / systemic, targeted / root-cause / hardening, …) with pros, cons, risk, effort, and expected files.
- **Structured task specs** — versioned `TaskSpec v1.0` JSON with requirements, non-goals, change boundaries, verification commands, and safety policy. Validated with Zod, saved under `.promptpilot/specs/`.
- **Change control** — flags out-of-scope files, protected paths, dependency changes, database migrations, auth/config edits, and deletions. Pre-existing user changes are baselined and protected.
- **Verification with evidence** — runs lint/typecheck/test/build, captures exit codes, durations, and output. Absent checks are reported as *not run*, never as success.
- **Evidence-based review** — maps every acceptance criterion to `evidence-pass` / `evidence-fail` / `unverified` and returns a verdict: `ready-for-human-review`, `needs-changes`, or `blocked`.
- **Persistent project context** — `.promptpilot/context.json` stores architecture, conventions, commands, design rules, and decisions, with staleness detection when key files change.
- **MCP resources & prompts** — the workflow instruction, the project profile, and reusable prompts for features, bug fixes, UI work, refactors, and code review.

## Installation

Requires **Node.js ≥ 18** and `git` on PATH (used for change inspection).

### From source (verified)

```bash
git clone https://github.com/Ntureyc/PromptPilot.git
cd PromptPilot
npm install        # also builds dist/ via the prepare script
node dist/index.js # starts the MCP stdio server
```

### Directly from GitHub via npm

```bash
# one-shot via npx
npx -y github:Ntureyc/PromptPilot

# or install globally
npm install -g github:Ntureyc/PromptPilot
```

> Note: npm's git-based installs must be allowed in your npm configuration and need working GitHub access (some locked-down environments disable git fetches, or fall back to SSH without a key). When in doubt, use the from-source install above — it is fully verified.

## Connecting to an MCP client

PromptPilot speaks **MCP over stdio**. Add it to any MCP-compatible client.

### Claude Code

```bash
claude mcp add promptpilot -- node /absolute/path/to/PromptPilot/dist/index.js
# or, if installed globally:
claude mcp add promptpilot -- promptpilot
```

### Cursor / Windsurf / Cline / VS Code MCP

```json
{
  "mcpServers": {
    "promptpilot": {
      "command": "node",
      "args": ["/absolute/path/to/PromptPilot/dist/index.js"],
      "env": { "PROMPTPILOT_ROOT": "/absolute/path/to/your/project" }
    }
  }
}
```

Using the GitHub install:

```json
{
  "mcpServers": {
    "promptpilot": {
      "command": "npx",
      "args": ["-y", "github:Ntureyc/PromptPilot"]
    }
  }
}
```

### Runtime options

| Option | Meaning |
|---|---|
| `--root <dir>` | Project root to operate on (overrides cwd) |
| `PROMPTPILOT_ROOT` env var | Same as `--root` |
| omitted | The client's current working directory |

## Quick start

In your coding agent, ask for something real:

> Use PromptPilot: build a navigation bar that looks nice.

The agent will run this flow (it is available as the `feature-development` / `ui-change` prompts and as the `promptpilot://agent-workflow` resource):

1. **`inspect_project`** — discovers Next.js + Tailwind + shadcn, an existing header component, project rules in `AGENTS.md`, and a dirty working tree.
2. **`expand_intent`** — records what you said, infers "reuse existing Tailwind tokens / preserve routes and auth / preserve uncommitted changes", and raises a **blocking open question**: *what does "nice" mean here — minimal, translucent, or bold?* (with concrete options).
3. **`generate_options`** — minimal refinement vs. visual overhaul vs. component-system approach, each with trade-offs and expected files.
4. **`create_task_spec`** — writes a validated spec with acceptance criteria, allowed files (`src/components/Header.tsx`, shared tokens), protected paths, and verification commands auto-detected from `package.json`.
5. **`record_baseline`** — snapshots the dirty tree so your uncommitted work is protected.
6. Implement.
7. **`check_change_scope`** — reads the real diff; any file outside the agreed scope, any dependency/auth/migration change, any deletion is flagged.
8. **`verify_implementation`** — runs `npm run typecheck / lint / test / build`, keeps exit codes and output.
9. **`review_implementation`** — verdict with per-criterion evidence and an explicit list of what remains **unverified**.

For small, low-risk changes the agent takes a fast path — no questionnaire for a one-line CSS fix.

## Tool reference

Full reference: **[docs/TOOL_REFERENCE.md](docs/TOOL_REFERENCE.md)**

| Tool | Responsibility |
|---|---|
| `inspect_project` | Project structure, instructions, stack, Git state |
| `expand_intent` | Vague request → requirements, assumptions, open questions, criteria, risk |
| `generate_options` | Distinct approaches with trade-offs |
| `create_task_spec` | Validated `TaskSpec v1.0`, persisted to `.promptpilot/specs/` |
| `record_baseline` | Snapshot HEAD + dirty files before implementation |
| `check_change_scope` | Diff vs. approved boundaries; flags risky categories |
| `verify_implementation` | Run checks, return real evidence |
| `review_implementation` | Evidence-based verdict + unverified items |
| `get_project_context` | Persistent profile + freshness |
| `update_project_context` | Record verified project knowledge |

## MCP resources and prompts

**Resources**

| URI | Content |
|---|---|
| `promptpilot://agent-workflow` | The recommended client-side workflow (see [docs/WORKFLOW.md](docs/WORKFLOW.md)) |
| `promptpilot://project-context` | The persistent project profile + freshness |
| `promptpilot://task-specs` | All saved task specifications |

**Prompts**

| Name | Use |
|---|---|
| `feature-development` | Full pipeline for a feature request (`request` arg) |
| `bug-fix` | Reproduce → root-cause fix → regression test (`request`) |
| `ui-change` | UI work with an explicit design-direction decision (`request`) |
| `refactor` | Behavior-preserving restructuring (`request`) |
| `code-review` | Review changes against a saved spec (`specId`) |

## The safety model

Change control is the core of PromptPilot. See **[docs/SAFETY_POLICY.md](docs/SAFETY_POLICY.md)** for the full policy.

- **Allowed changes** — the agreed files (globs in the spec) and their required supporting files.
- **Approval-required** — dependency/lockfile changes, database migrations, auth/config edits, public API changes, file deletions.
- **Protected** — `.git`, `.env*`, key material; never modified under any circumstance.
- **Pre-existing user changes** — baselined before implementation; touching them is reported loudly.
- **Destructive operations** — never silently delete user data, overwrite uncommitted work, force-push, or reset a dirty tree. Reverts are targeted, never wholesale.
- **Completion requirements** — relevant checks must actually run and pass; anything unverified is stated as unverified.

No tool can guarantee software correctness. PromptPilot enforces boundaries and demands evidence at multiple levels instead.

## Task specification

Specs are versioned JSON (`schemaVersion: "1.0"`), validated with Zod, and saved to `.promptpilot/specs/<id>.json`. Schema reference: **[docs/TASK_SPEC_SCHEMA.md](docs/TASK_SPEC_SCHEMA.md)**. A full worked example: **[examples/task-spec.example.json](examples/task-spec.example.json)**.

The directory is self-ignored (`.promptpilot/.gitignore`), so PromptPilot's own state never pollutes your diffs.

## Development

```bash
npm install
npm run build        # tsc → dist/
npm test             # bun test: 29 unit tests
npm run test:node    # build + full MCP stdio integration test (38 checks)
```

Architecture (see `src/`):

```
src/
├── index.ts          # MCP server entry (stdio transport)
├── tools.ts          # 10 tools
├── resources.ts      # 3 resources + workflow text
├── prompts.ts        # 5 reusable prompts
└── lib/
    ├── project.ts    # context discovery
    ├── intent.ts     # intent expansion
    ├── options.ts    # implementation options
    ├── spec.ts       # TaskSpec v1.0 schema + persistence
    ├── policy.ts     # change-scope enforcement
    ├── verify.ts     # check runner (real evidence only)
    ├── review.ts     # evidence-based review
    ├── context.ts    # persistent project profile
    └── git.ts        # Git state + baseline
```

## Limitations (honest list)

- `expand_intent`, `generate_options`, and `review_implementation` are **deterministic engines**, not models. They structure the decision and ground it in project facts; semantic judgment ("is this design actually good?") stays with you and your agent — and is always labelled `unverified` in reports.
- Verification runs the project's own commands. If a project has no tests, PromptPilot reports *no checks ran* rather than pretending.
- The first release is a local stdio server. Multi-agent orchestration, dashboards, and semantic indexing are deliberately out of scope (see the roadmap).

## Roadmap

1. ✅ **Foundation** — context-aware task planning (this release)
2. **Execution** — tighter change boundaries, git-worktree isolation option
3. **Verification** — bounded auto-fix retries with failure diagnosis
4. **Context** — smarter staleness and retrieval
5. **Expansion** — multi-agent and team-level policies

## License

[MIT](LICENSE)
