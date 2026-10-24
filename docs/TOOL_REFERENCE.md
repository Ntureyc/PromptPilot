# PromptPilot tool reference

All tools return JSON as `text` content. Errors come back as `isError: true` with a message — the server never crashes on bad input.

Project root resolution (every tool): explicit `root` argument → `PROMPTPILOT_ROOT` env → client cwd.

---

## inspect_project

Discover project structure, instructions, stack, and current Git state. **Run before planning any non-trivial change.**

**Input**

| Field | Type | Required | Description |
|---|---|---|---|
| `root` | string | no | Project root directory |

**Output**

```jsonc
{
  "root": "/abs/path",
  "inspectedAt": "ISO time",
  "projectType": "npm",                      // npm / python / go / rust / npm+python / unknown
  "manifests": [ { "kind": "npm", "file": "package.json", "scripts": {...}, "dependencies": {...} } ],
  "instructionFiles": [ { "file": "AGENTS.md", "excerpt": "..." } ],
  "detectedStack": ["typescript", "docker"],
  "frameworks": ["next.js", "tailwindcss", "prisma"],
  "scripts": { "test": "vitest run", "build": "tsc" },
  "structure": { "top": ["src/", "README.md"], "fileCount": 123, "byExtension": { ".ts": 90 } },
  "git": { "isRepo": true, "branch": "main", "changedFiles": [...], "diffStat": "...", "lastCommit": {...} },
  "notes": ["Working tree is dirty (3 changed/untracked files) — pre-existing changes must be preserved."]
}
```

---

## expand_intent

Convert a vague request into explicit requirements, assumptions, and open questions.

**Input**

| Field | Type | Required | Description |
|---|---|---|---|
| `request` | string | yes | The request as the user wrote it |
| `root` | string | no | Project root |
| `useProject` | boolean | no | Inspect the project first to ground inferences (default true) |

**Output**

```jsonc
{
  "request": "Build a navigation bar that looks nice.",
  "restatedGoal": "Ui: Build a navigation bar that looks nice.",
  "taskCategory": "ui",                      // feature | fix | refactor | ui | testing | docs | migration | removal | unknown
  "statedRequirements":  [ { "text": "...", "source": "stated", "confidence": "high" } ],
  "inferredRequirements":[ { "text": "Use the existing Tailwind design tokens...", "source": "inferred", "confidence": "high" } ],
  "assumptions": [ { "assumption": "...", "verifyBy": "..." } ],
  "openQuestions": [ { "question": "...", "reason": "...", "suggestedOptions": ["A", "B", "C"], "blocking": true } ],
  "acceptanceCriteriaDraft": [ { "id": "AC-1", "text": "...", "check": "manual-review" } ],
  "riskLevel": "medium",
  "riskReasons": ["..."],
  "mentionedPaths": ["src/components/Header.tsx"],
  "mentionedTechnologies": ["tailwind"],
  "suggestedScopeHints": ["Modify the existing component where possible..."]
}
```

**Rules encoded here**

- Stated vs inferred is always separated; nothing inferred is ever presented as something the user said.
- Every assumption carries a `verifyBy` — a guess without a verification path is not recorded.
- Vague visual/quality wording ("nice", "better", "robust"…) becomes a *blocking* open question with concrete options.
- Acceptance criteria always include scope (`check_change_scope`) and verification (`verify_implementation`) gates.

---

## generate_options

Produce 2–3 distinct implementation approaches with real trade-offs. Skip for trivial changes.

**Input**: `request` (string, required), `root`, `count` (2–3).

**Output**

```jsonc
{
  "taskCategory": "ui",
  "options": [
    {
      "id": "opt-1",
      "name": "Minimal refinement",
      "approach": "Improve the existing ... in place ...",
      "pros": ["Smallest diff", "Low regression risk"],
      "cons": ["May not satisfy a request that expects a visible redesign"],
      "risk": "low",
      "effort": "small",
      "whenToChoose": "When the current structure is fine and only the polish is missing.",
      "expectedTouch": ["the existing component file", "its colocated styles if any"]
    }
  ],
  "recommendation": "opt-1",
  "decisionNeeded": true,
  "decisionQuestion": "Which visual direction should the implementation take?"
}
```

Option families by category: UI → minimal / overhaul / component-system; fix → targeted / root-cause / hardening; feature → extend existing / new module / shared layer; refactor → incremental / consolidated / extract primitives; generic → minimal / structured with tests / spike first.

---

## create_task_spec

Build a validated **TaskSpec v1.0** (see [TASK_SPEC_SCHEMA.md](TASK_SPEC_SCHEMA.md)) and persist it to `.promptpilot/specs/<id>.json` (self-ignored, never pollutes diffs).

**Input**

| Field | Type | Required | Description |
|---|---|---|---|
| `request` | string | yes | The request |
| `root` | string | no | Project root |
| `title` | string | no | Short title (derived from request when omitted) |
| `chosenOptionId` | string | no | Option id from `generate_options` to lock in |
| `nonGoals` | string[] | no | Explicit non-goals |
| `allowedFiles` | string[] | no | Extra allowed globs (`src/components/Header.tsx`, `src/**`) |
| `protectedPaths` | string[] | no | Globs that must never change |
| `verificationCommands` | {label, command, timeoutMs?}[] | no | Override auto-detected checks |
| `save` | boolean | no | Persist (default true) |

**Output**: `{ spec, savedPath, unresolvedBlockingQuestions }`.

Verification commands are auto-detected from `package.json` scripts (`typecheck`, `lint`, `test`, `build`), `pytest` for Python projects, and `go test ./...` for Go projects. If none exist, the spec records *"no checks available"* instead of inventing any.

---

## record_baseline

Snapshot the working tree (HEAD + dirty file list) before implementation starts.

**Input**: `root`.
**Output**: `{ takenAt, head, dirtyFiles: [...] }`.

Pass the returned baseline to `check_change_scope` semantics: files dirty *before* the task must not be modified by the task. (`review_implementation` applies this automatically when told; the report lists `baselineFilesTouched`.)

---

## check_change_scope

Compare current Git changes (or explicit files) against approved boundaries.

**Input**

| Field | Type | Required | Description |
|---|---|---|---|
| `root` | string | no | Project root |
| `specId` | string | no* | Saved spec whose `changeScope` to enforce |
| `allowedFiles` | string[] | no* | Allowed globs when no `specId` |
| `protectedPaths` | string[] | no | Protected globs when no `specId` |
| `files` | {path, status}[] | no | Explicit changes instead of reading Git |

\* provide `specId` **or** `allowedFiles`.

**Classification per changed file**

| Category | Trigger | Default handling |
|---|---|---|
| `dependency-change` | package.json, lockfiles, pyproject, go.mod, Cargo.toml, Gemfile… | approval required |
| `database-migration` | migrations dirs, `schema.prisma`, `*.sql` | approval required |
| `auth-or-config` | `*auth*`, `*login*`, `*session*`, `*token*`, `.env*`, `config.*`, `*secret*`, `*credential*` | approval required |
| `public-api-change` | `api/`, `routes/`, `controllers/`, `endpoints/` | flagged |
| `file-deletion` | any deleted file | approval required |
| `tests`, `docs`, `code` | by path/extension | normal |

**Output**: `{ verdict, findings[], summary, baselineFilesTouched, baselineFilesPreserved, instructions[] }` where `verdict ∈ within-scope | needs-approval | scope-violation`.

---

## verify_implementation

Run checks and return **real evidence** — exit code, duration, output. Never fabricates results.

**Input**: `root`, `specId` (run the spec's commands) **or** `commands` ({label, command, timeoutMs?}[]). With neither, auto-detects from the project.

**Output**

```jsonc
{
  "ranAt": "ISO time",
  "results": [
    { "label": "test", "command": "npm run test", "status": "passed", "exitCode": 0,
      "durationMs": 4210, "evidence": "exit code: 0 (4210 ms)\n--- stdout ---\n..." }
  ],
  "overall": "passed",   // passed | failed | no-checks
  "notes": []
}
```

`no-checks` means nothing ran — report it as *"checks did not run"*, never as success.

---

## review_implementation

Evaluate the current working tree against a saved spec with evidence-based verdicts.

**Input**: `root`, `specId` (required), `runChecks` (boolean, default false).

**Output**

```jsonc
{
  "verdict": "ready-for-human-review",  // or needs-changes | blocked
  "scope": { ...ScopeReport },
  "verification": { ...VerificationReport },
  "criteria": [ { "id": "AC-2", "check": "check_change_scope", "status": "evidence-pass", "evidence": "..." } ],
  "changedFiles": [...],
  "diffStat": "...",
  "risks": ["No checks ran — correctness is unproven even if the diff looks clean."],
  "unverified": ["AC-1: ..."],
  "summary": "Ready for human review: 2 file(s) changed, 2/5 criteria backed by evidence, 3 still unverified."
}
```

Criterion statuses: `evidence-pass` / `evidence-fail` (proven by scope report or check results) and `unverified` (semantic — requires human or agent judgment). Semantic criteria are **never** auto-marked as passed.

---

## get_project_context / update_project_context

Persistent project intelligence in `.promptpilot/context.json`.

**get**: `{ context, freshness: { fresh, staleFiles, missing } }` — `staleFiles` lists key files (package.json, AGENTS.md, README.md…) whose content changed since the profile was last verified.

**update input**: `architecture` (string), `conventions`, `designRules`, `constraints`, `knownRisks` (string[]), `commands` (record), `decision` ({decision, reason}), `changeNote` (string). Only record **verified** facts.
