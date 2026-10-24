# TaskSpec v1.0 schema

Every task PromptPilot plans is serialized as a versioned JSON document, validated with Zod on both write and read. Specs are stored at `.promptpilot/specs/<id>.json` (the directory is self-ignored so it never appears in your diffs).

```jsonc
{
  "schemaVersion": "1.0",
  "id": "beautify-app-output-mxk1a2b",       // slug + base36 timestamp
  "title": "Ui: Build a navigation bar that looks nice.",
  "request": "Build a navigation bar that looks nice.",  // verbatim user words
  "createdAt": "2026-10-24T09:00:00.000Z",
  "projectRoot": "/abs/path/to/project",
  "taskCategory": "ui",                       // feature | fix | refactor | ui | testing | docs | migration | removal | unknown

  "requirements": [
    { "text": "Build a navigation bar that looks nice.", "source": "stated", "confidence": "high" },
    { "text": "Use the existing Tailwind design tokens/classes...", "source": "inferred", "confidence": "high" }
  ],                                          // source: stated | inferred | accepted

  "nonGoals": [
    "No unrelated refactoring",
    "No dependency or configuration changes unless required by the task",
    "No changes to pre-existing uncommitted user work"
  ],

  "assumptions": [
    { "assumption": "UI work reuses existing component patterns...", "verifyBy": "Locate the closest existing component and compare." }
  ],

  "openQuestions": [
    { "question": "What does \"nice\" mean concretely here?",
      "reason": "Visual direction is not defined for this project.",
      "suggestedOptions": ["Minimal and refined", "Translucent and modern", "Bold and prominent"],
      "blocking": true }
  ],

  "chosenOption": {                           // optional — from generate_options
    "id": "opt-1", "name": "Minimal refinement",
    "approach": "...", "risk": "low", "effort": "small"
  },

  "acceptanceCriteria": [
    { "id": "AC-1", "text": "...", "check": "manual-review" },
    { "id": "AC-7", "text": "No files outside the agreed change scope were modified.", "check": "check_change_scope" },
    { "id": "AC-8", "text": "All applicable project checks pass...", "check": "verify_implementation" }
  ],                                          // check: manual-review | check_change_scope | verify_implementation

  "changeScope": {
    "allowedFiles": ["src/components/Header.tsx", "src/**"],   // globs (supports **, *, ?)
    "protectedPaths": [".git/**", ".env", ".env.*", "**/*.pem", "**/*.key"],
    "allowedCategories": [],
    "requiresApproval": ["dependency-change", "database-migration", "auth-or-config", "file-deletion"]
  },

  "verification": {
    "commands": [
      { "label": "typecheck", "command": "npm run typecheck", "timeoutMs": 300000 },
      { "label": "test",     "command": "npm run test",      "timeoutMs": 300000 }
    ],
    "notes": []                               // e.g. ["No lint/test/build commands were detected..."]
  },

  "policy": {
    "destructiveActionsAllowed": false,       // fixed by schema
    "preserveDirtyWorkingTree": true,
    "maxFixRetries": 2,
    "note": "optional"
  },

  "status": "draft"                           // draft | approved | in-progress | done
}
```

## Semantics

- **`requirements[].source`** — `stated` is the user's own words, `inferred` is derived from project facts, `accepted` is inferred-and-confirmed-by-the-user. Never blur these.
- **`acceptanceCriteria[].check`** — how the criterion is evaluated by `review_implementation`:
  - `check_change_scope` → proven from the scope report (`evidence-pass`/`evidence-fail`)
  - `verify_implementation` → proven from check exit codes
  - `manual-review` → always reported `unverified` until a human/agent judges it
- **`changeScope.allowedFiles`** — glob syntax: `src/**`, `**/*.test.ts`, `src/app.ts`. A bare directory name (`src`) covers everything inside it. PromptPilot's own `.promptpilot/` state is ignored by scope checks.
- **`policy.destructiveActionsAllowed`** is schema-locked to `false` — there is no way to opt in.

## Versioning

`schemaVersion` is validated as the literal `"1.0"`. Future versions will migrate old specs explicitly; a spec with an unknown version is rejected rather than guessed at.
