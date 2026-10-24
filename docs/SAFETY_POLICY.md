# PromptPilot safety policy

The goal: asking for one feature must not break unrelated functionality. No prompt or tool can *guarantee* that — even a small change can introduce an unexpected regression. The practical solution PromptPilot implements is **enforced boundaries + evidence at multiple levels**.

## Change policy

| Class | Rule |
|---|---|
| **Allowed changes** | The agreed component/files (`changeScope.allowedFiles`) and necessary supporting files. Preserve unrelated logic and existing user changes. |
| **Unexpected changes** | Unrelated files, dependency changes, API modifications, database migrations, and changes to authentication or configuration are **flagged**. Material impact requires explicit approval. |
| **Destructive operations** | Never silently delete user data, overwrite uncommitted work, force-push, or perform irreversible production operations. `policy.destructiveActionsAllowed` is schema-locked to `false`. |
| **Completion requirements** | Relevant checks must pass **and actually run**. If a check cannot run, that is stated explicitly — absence of evidence is never success. |

## Categories requiring approval

Detected automatically by `check_change_scope`:

- **dependency-change** — `package.json`, lockfiles, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`, …
- **database-migration** — `migrations/`, `alembic/`, `prisma/migrations/`, `db/migrate/`, `schema.prisma`, `*.sql`
- **auth-or-config** — anything matching `*auth*`, `*login*`, `*session*`, `*token*`, `*permission*`, `*role*`, `*secret*`, `*credential*`, `config.*`, `.env*`
- **file-deletion** — any deleted file
- **public-api-change** — `api/`, `routes/`, `controllers/`, `endpoints/`

## Protected paths (never modified)

`.git/**`, `.env`, `.env.*`, `**/*.pem`, `**/*.key` — extendable per spec via `protectedPaths`. Touching a protected path is always a `scope-violation`, regardless of `allowedFiles`.

## Preserving user work

1. `record_baseline` snapshots HEAD + every dirty/untracked file before implementation starts.
2. `check_change_scope` / `review_implementation` compare the final diff against that baseline.
3. Any pre-existing user file modified by the task is reported as `baselineFilesTouched` with the instruction: *"restore them — user work is not yours to overwrite."*

When reverting is necessary, reverts are **targeted** (per file/region). Never `git reset --hard`, never `git checkout .`, never `git clean` on a tree containing user work.

## Verification evidence

`verify_implementation` records, per command: exit code, duration, and captured output. The report's `overall` is one of:

- `passed` — every command exited 0 (proof attached)
- `failed` — at least one command failed or timed out (proof attached)
- `no-checks` — nothing ran. Report as *"checks did not run."*

`review_implementation` maps each acceptance criterion to `evidence-pass`, `evidence-fail`, or `unverified`. Semantic criteria are **never** auto-passed.

## What PromptPilot does not claim

- It does not prove a change is safe. Diff inspection is one signal; regression tests, baselines, type checks, and runtime checks are complementary evidence.
- It does not make design judgments. Options and trade-offs are structured; the decision stays with the human and the agent.
- It does not run in production. It is a local developer tool operating on a working directory you point it at.
