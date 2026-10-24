# Agent instructions (paste into CLAUDE.md / AGENTS.md / .cursorrules)

Add this to your project's agent instructions so your coding agent uses PromptPilot at the right stages. The same text is exposed as the `promptpilot://agent-workflow` resource and baked into the bundled prompts (`feature-development`, `bug-fix`, `ui-change`, `refactor`, `code-review`).

```markdown
## PromptPilot workflow (required for non-trivial changes)

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
- For small, low-risk changes, take a fast path: inspect_project + create_task_spec with defaults, then implement and verify.

Reporting: end every task with an implementation report — changed files, scope verdict,
check results (with exit codes), acceptance-criteria status, and explicit unverified items.
```

## Fast-path rule of thumb

- Risk `low` (single file, no behavior outside it, no deps/auth/config surface) → fast path.
- Risk `medium`/`high` → full pipeline; resolve **blocking** open questions with the user before implementing.
