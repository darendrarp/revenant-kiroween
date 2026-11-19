# AGENTS.md — REVENANT

Instructions for any AI agent (Kiro, or others) working in this repo.

## Project

REVENANT resurrects dead links via the Internet Archive Wayback Machine.
Static frontend (`public/`), zero-dependency Vercel serverless API (`api/`),
Node built-in tests (`tests/`). See `.kiro/steering/` for product, tech, and
structure context, and `.kiro/specs/revenant/` for the spec.

## Rules

1. **Spec first.** New features start as a spec under `.kiro/specs/<feature>/`
   (requirements.md → design.md → tasks.md). Do not write feature code before
   the spec exists. Keep `tasks.md` checkboxes honest: tick only what is done
   and verified.
2. **Zero dependencies.** Do not add npm packages. Use Node built-ins only.
   If a capability seems to need a package, implement the minimal version or
   ask before adding one.
3. **Validate before you fetch.** Every user-supplied URL goes through
   `normalizeUrl()` in `api/_lib.js`. Never fetch an unvalidated URL.
   `/api/extract` fetches `web.archive.org` hosts only — do not widen that.
4. **Functions must finish in <10s.** Short timeouts, parallel calls, partial
   results over hanging. Test with `npm test` and `npm run dev`.
5. **Never fabricate archive data.** If the Wayback Machine has no snapshot or
   cannot be reached, say so. No placeholder snapshot URLs, ever.
6. **Never gitignore `.kiro/`.** The hackathon requires it in the repo.
7. **Run the tests** (`npm test`) after changing `api/` or `tests/`. The
   `run-tests` hook does this automatically in Kiro sessions.
