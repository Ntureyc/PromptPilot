# PromptPilot agent workflow

This is the client-side workflow that makes PromptPilot reliable. An MCP server cannot intercept or rewrite messages — the **coding agent decides when to call tools**. Paste this into your agent's project instructions (or use the `promptpilot://agent-workflow` resource / the bundled prompts).

---

## The workflow

```markdown
Before implementing a non-trivial coding request:

1. Inspect the relevant project context using PromptPilot (`inspect_project`).
2. Read the applicable project instructions and existing code.
3. Identify missing information and distinguish assumptions from facts (`expand_intent`).
4. Present meaningful alternatives when the user must make a decision (`generate_options`).
5. Create a task specification with acceptance criteria and change boundaries (`create_task_spec`),
   and snapshot the working tree (`record_baseline`).
6. Implement only the agreed scope.
7. Review the actual changes (`check_change_scope`) and run appropriate verification (`verify_implementation`).
8. Report exactly what changed, what was tested, and what remains uncertain (`review_implementation`).

Do not overwrite unrelated user changes.
Do not claim that tests or builds passed unless they actually ran.
Do not silently expand the task scope.
```

## Execution lifecycle

1. Record the initial Git status and baseline check results (`record_baseline`).
2. Inspect the relevant files and establish task boundaries.
3. Generate the task specification and resolve **blocking** open questions with the user.
4. Implement the change without overwriting unrelated work.
5. Inspect the complete diff for scope violations and suspicious changes (`check_change_scope`).
6. Run targeted tests, type checks, linting, and a build as appropriate (`verify_implementation`).
7. Fix failures attributable to the implementation, then re-run the affected checks (bounded retries, see the spec's `policy.maxFixRetries`).
8. Report the final outcome with actual test evidence (`review_implementation`).

Use Git worktrees or another isolated workspace for tasks that need stronger separation. Never reset a dirty working tree or roll back arbitrary files to repair a failed task.

## The fast path

Small, low-risk changes must not trigger a questionnaire:

- One file, no behavior outside it, no dependency/config/auth surface.
- → `inspect_project` + `create_task_spec` with defaults, implement, `verify_implementation`, done.
- Skip `generate_options` entirely; skip `expand_intent`'s open questions (they will be non-blocking by classification).

The risk classification from `expand_intent` decides which path applies: `low` → fast path, `medium`/`high` → full pipeline with human confirmation on blocking questions.

## When to stop and ask

- `expand_intent` returns **blocking** open questions (typically undefined visual direction or undefined behavior).
- `check_change_scope` returns `needs-approval` (dependency, migration, auth/config, deletion).
- Verification fails after `policy.maxFixRetries` bounded fix attempts.
- The request would touch `protectedPaths` under any interpretation.

## Reporting format

```
## Implementation report
- Changed: <files with one-line purpose each>
- Scope: within-scope | needs-approval (<what needs approval>) | scope-violation (<what>)
- Checks: <command> → passed/failed (exit N) / did not run
- Acceptance criteria: <id> evidence-pass | evidence-fail | UNVERIFIED
- Unverified / risks: <explicit list>
```

**Never claim success merely because the implementation finished responding.**
