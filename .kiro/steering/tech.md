---
inclusion: always
---

# Tech — REVENANT

## Stack

- **Frontend:** static HTML/CSS/vanilla JS in `public/`. No framework, no build
  step, no bundler. One page, three modes (Resurrect / Audit / Bulk).
- **Backend:** Vercel Serverless Functions, Node 20+, CommonJS, **zero npm
  dependencies**. Four endpoints in `api/` + shared `api/_lib.js`.
- **Tests:** Node's built-in test runner (`node --test`). No test framework.
- **Hosting:** Vercel (Hobby). Static `public/` + `api/` functions.
- **External APIs:** Internet Archive Wayback Machine only —
  `archive.org/wayback/available` and `web.archive.org`. Public, keyless.

## Constraints

- Every serverless function must finish inside Vercel's 10s Hobby limit:
  upstream calls get short timeouts (5–8s), run in parallel, and return partial
  results instead of waiting for stragglers.
- No `npm install` at deploy time (zero deps) — the build cannot fail on
  dependency resolution.
- All user-supplied URLs are validated before any fetch: HTTP(S) only, no
  localhost, no private/link-local IP literals. The reader endpoint
  (`/api/extract`) only fetches `web.archive.org` hosts.
- Frontend fetches use a client-side timeout (12s) and always render an error
  state with a retry action — no frozen screens.

## Conventions

- CommonJS (`require`/`module.exports`) everywhere, including tests.
- API handlers are `(req, res)` functions; shared logic lives in `api/_lib.js`
  and is unit-tested, not duplicated per endpoint.
- Dates from the archive are 14-digit timestamps (`YYYYMMDDhhmmss`); display
  only the year on tombstones, full date in the snapshot detail.
- Keep functions small and named after what they prove (`checkAlive`,
  `waybackClosest`); a function that touches the network takes an explicit
  timeout parameter.
