# Tasks — REVENANT: Resurrect the Dead Web

> Implementation plan for the spec in `requirements.md` / `design.md`.
> Each task cites the requirement(s) it satisfies. Check a box only when the
> work is done and verified (test run, smoke test, or live check).
> Written 2026-11-19 before implementation; status updated as the build proceeds.

## Phase 1 — Foundation

- [x] 1. Scaffold the repo: `public/`, `api/`, `tests/`, `scripts/`, `docs/`,
      `package.json` (zero deps, `npm test` via `node --test`), `vercel.json`,
      `.gitignore` (must NOT ignore `.kiro/`), MIT `LICENSE`
      — _Req: 8_
- [x] 2. Write the shared API library `api/_lib.js`: `normalizeUrl` + SSRF guard,
      `fetchWithTimeout` with byte cap, `checkAlive` (HEAD + GET fallback),
      `waybackClosest`, `waybackTimeline` (anchor sampling), `extractLinks`,
      `extractReadable`, JSON response helpers
      — _Req: 1, 2, 3, 4, 7_

## Phase 2 — API endpoints

- [x] 3. Implement `GET /api/resurrect` (liveness + closest snapshot + timeline +
      tombstone) with partial-result degradation on upstream timeouts
      — _Req: 1, 2, 7_
- [x] 4. Implement `POST /api/check` (1–12 URLs, parallel liveness, snapshots for
      dead URLs) with input validation and the 12-URL limit
      — _Req: 4, 5, 7_
- [x] 5. Implement `GET /api/audit` (fetch page, extract ≤60 links, mark
      internal/external)
      — _Req: 4_
- [x] 6. Implement `GET /api/extract` (reader view, `web.archive.org`-only host
      guard, 1 MB cap)
      — _Req: 3, 7_

## Phase 3 — Frontend

- [x] 7. Build `public/index.html`: hero + search, Resurrect/Audit/Bulk tabs,
      graveyard section, snapshot-viewer and reader modals, footer
      — _Req: 1, 4, 5, 6, 8_
- [x] 8. Build `public/styles.css`: graveyard theme (dark, fog, tombstones),
      responsive layout, loading/error states, `prefers-reduced-motion`
      — _Req: 8_
- [x] 9. Build `public/app.js`: tab logic, API calls with client timeouts,
      tombstone + timeline rendering, chunked audit checking with progress,
      bulk table, share-hash (`#r=`) deep links, localStorage graveyard
      — _Req: 1, 2, 3, 4, 5, 6, 8_
- [x] 10. Verify three one-click demo links (famous dead sites) against the live
       API: each must be dead AND have a snapshot; wire only the verified ones
       — _Req: 8_

## Phase 4 — Tests, docs, ship

- [x] 11. Write `tests/lib.test.js` (unit) and `tests/property.test.js`
       (property-style, generated inputs); `npm test` green
       — _Req: 7_
- [x] 12. Add `scripts/dev-server.mjs` (local static + API server) and smoke-test
       the full flow locally (resurrect → reader → audit → bulk)
       — _Req: 1–6_
- [x] 13. Write `README.md` (features, local dev, API docs, Kiro usage, credits),
       `docs/KIRO_USAGE.md` (honest Kiro write-up), `docs/SUBMISSION.md`
       (submission package), `docs/DEMO_VIDEO_SCRIPT.md` (<3 min script)
       — _Req: 8_
- [x] 14. Push to public GitHub repo `darendrarp/revenant-kiroween` (MIT license,
       `.kiro/` committed, not ignored)
       — _Req: 8_
- [ ] 15. Deploy to Vercel, verify the live app end-to-end (resurrect a real dead
       link, reader view, audit, bulk), record the live URL in `SUBMISSION.md`
       — _Req: 1–8_
