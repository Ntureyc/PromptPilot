# Implementation report — example format

This is the required closing report for any PromptPilot-managed task. The values below show the format; your agent fills it from `review_implementation` output (which carries real evidence, never assumptions).

```markdown
## Implementation report

- Spec: navigation-bar-redesign-example (draft → done)
- Changed:
  - src/components/Header.tsx — rebuilt nav markup with refined spacing/hover states
  - src/app/globals.css — added nav hover token
- Scope: within-scope (2 files, both in changeScope.allowedFiles; 0 baseline files touched)
- Checks:
  - typecheck (npm run typecheck) → passed (exit 0)
  - lint (npm run lint)       → passed (exit 0)
  - test (npm run test)        → passed (exit 0, 41 tests)
  - build (npm run build)      → passed (exit 0)
- Acceptance criteria:
  - AC-1 navigation bar implemented            → UNVERIFIED (semantic — needs your look)
  - AC-2 stated requirement satisfied          → UNVERIFIED (semantic)
  - AC-3 no out-of-scope files modified        → evidence-pass
  - AC-4 checks pass                           → evidence-pass
  - AC-5 pre-existing changes preserved        → evidence-pass (src/lib/utils.ts untouched)
- Unverified / risks:
  - Visual result ("looks nice") not judged by tooling — please review the rendered header.
  - No visual regression tests exist in this project.
- Verdict: ready-for-human-review
```

Rules for the report:

1. Every check line must carry an exit code from an actually-run command. If a check could not run, write `did not run (reason)`.
2. Semantic criteria stay `UNVERIFIED` — never promote them to passed without human judgment.
3. If `review_implementation` returns `needs-changes` or `blocked`, the report says so in the verdict line, with the failing evidence above it.
