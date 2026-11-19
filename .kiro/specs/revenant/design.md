# Design — REVENANT: Resurrect the Dead Web

> Companion to `requirements.md`. Written before implementation; updated only when
> a design decision changed during the build (see §7, Decision Log).

## 1. Overview

REVENANT is a zero-dependency web app: a static single-page frontend plus four
serverless API functions on Vercel. All archive data comes from the Internet
Archive's public, keyless Wayback Machine APIs. There is no database, no account,
and no build step — the repo can be deployed by pushing to Vercel, or run locally
with the included Node dev server.

## 2. Architecture

```
Browser (public/index.html + app.js + styles.css)
    │  fetch, no framework, no build step
    ▼
Vercel Serverless Functions (Node 20+, CommonJS, zero npm deps)
    ├── api/resurrect.js   GET  ?url=          liveness + closest snapshot + timeline
    ├── api/check.js       POST {urls:[...]}   bulk liveness (+ snapshots for dead)
    ├── api/audit.js       GET  ?url=          fetch page, extract outbound links
    ├── api/extract.js     GET  ?url=          reader view of a web.archive.org snapshot
    └── api/_lib.js        shared: validation, fetch-with-timeout, Wayback client,
                           link extraction, readable-text extraction
    │  outbound HTTPS only (public hosts)
    ▼
Internet Archive                  Target sites (liveness HEAD/GET)
    ├── archive.org/wayback/available   (closest snapshot, supports &timestamp=)
    └── web.archive.org/web/<ts>/<url>  (snapshot pages, reader fetch)
```

### Why no framework, no build step

- The app is one page with three modes; vanilla JS keeps the bundle tiny and the
  repo reviewable by judges in minutes.
- Zero npm dependencies means `npm install` cannot fail and the Vercel build is
  just "serve `public/`, run `api/`".
- The timeline does **not** use the CDX API: CDX queries proved slow/unreliable
  from the build environment, so the timeline samples the availability API at six
  anchor years (2000/2005/2010/2015/2020/2025) in parallel and de-duplicates by
  snapshot year. Partial results are returned with `timelineComplete: false`.

## 3. Components

### 3.1 Frontend (`public/`)

| File | Role |
| --- | --- |
| `index.html` | Shell: hero + search, three mode tabs (Resurrect / Audit / Bulk), graveyard section, modals (snapshot viewer, reader view), footer |
| `styles.css` | Graveyard theme: dark background, animated fog layers, tombstone cards, candle-glow accents, responsive layout, `prefers-reduced-motion` support |
| `app.js` | All client logic: tab switching, API calls with timeout, rendering, share-hash (`#r=`) deep links, localStorage graveyard |

State is local and ephemeral except the graveyard (localStorage key
`revenant-graveyard`, capped at 100 entries, newest first).

### 3.2 API layer (`api/`)

Shared helpers in `api/_lib.js`:

- `normalizeUrl(input)` — trims, assumes `https://` when no scheme, parses, and
  rejects non-HTTP(S) schemes, localhost, `.local`/`.internal`, and private /
  loopback / link-local IP literals (SSRF guard for literal IPs).
- `fetchWithTimeout(url, opts)` — `AbortController` timeout, optional byte cap
  enforced while streaming (the reader aborts oversized bodies instead of
  buffering them).
- `checkAlive(url)` — HEAD first, GET-with-`Range: bytes=0-0` fallback (some
  servers reject HEAD); follows redirects; `alive` = final status 200–399.
- `waybackClosest(url, {timestamp})` — availability API; returns the closest
  snapshot or `{available:false}`; timeouts surface as `{error:'timeout'}` so
  callers can degrade gracefully.
- `waybackTimeline(url)` — six anchor-year availability calls in parallel,
  de-duplicated by snapshot year.
- `extractLinks(html, baseUrl, limit)` — regex `href` extraction, relative-URL
  resolution, de-duplication, internal/external marking, capped.
- `extractReadable(html)` — strips script/style/nav/header/footer/svg, returns
  `{title, headings[], text}` with collapsed whitespace.
- `sendJson(res, status, obj)` / `sendError(res, status, message)`.

### 3.3 Endpoints

| Endpoint | Input | Output | Timeouts |
| --- | --- | --- | --- |
| `GET /api/resurrect?url=` | one URL | `{url, alive, status, finalUrl, snapshot, timeline, tombstone}` | all three lookups in parallel, 6s each |
| `POST /api/check` | `{urls: string[]}` (1–12) | `{results: [{url, alive, status, snapshot?}]}` | liveness + snapshot in parallel, 6s each |
| `GET /api/audit?url=` | one page URL | `{url, title, links: [{url, internal}]}` (≤60) | fetch 8s, 1.5 MB cap |
| `GET /api/extract?url=` | a `web.archive.org` URL | `{title, headings, text, truncated}` | fetch 8s, 1 MB cap |

All endpoints stay inside Vercel's 10s Hobby function limit by design: every
upstream call has a short timeout, calls run in parallel, and partial results are
returned instead of waiting for stragglers. The audit deliberately splits work:
`audit` only extracts links; the browser then checks them in chunks through
`check`, so no single function call can time out on a link-heavy page.

## 4. Data flow — resurrect a dead link

```
User submits URL
  → normalize + validate (reject private/localhost)
  → in parallel: checkAlive(url) + waybackClosest(url) + waybackTimeline(url)
    (parallel so the total stays under Vercel's 10s limit; timeline discarded
    when no snapshot exists)
  → tombstone: born = earliest timeline year, died = latest timeline year
    (falls back to the closest snapshot's year when the timeline is empty)
  → response → frontend renders tombstone + timeline + actions
  → on success, frontend records the resurrection in the graveyard
```

## 5. Error handling

- Invalid URL → `400 {error}` with a human-readable message, no fetch attempted.
- Upstream timeout → the affected field reports the timeout; the rest of the
  response still renders (e.g. "archive lookup timed out — try again").
- Wayback unreachable → `snapshot: null, archiveError: "unavailable"`; the UI
  says the archive could not be reached and never invents a snapshot.
- Frontend: every fetch has a client-side timeout (12s) and renders an error
  state with a retry button.

## 6. Testing strategy

- `tests/lib.test.js` — unit tests for `normalizeUrl` (scheme default, rejection
  of localhost/private IPs/non-HTTP schemes), `extractLinks` (relative
  resolution, de-dup, cap, internal/external), `extractReadable` (script/style
  stripping, title/headings), and timeline de-duplication.
- `tests/property.test.js` — property-style tests with generated inputs: the
  normalizer never throws an unexpected error type on arbitrary strings; link
  extraction never crashes on arbitrary HTML and only returns valid HTTP(S)
  URLs; readable extraction never returns uncollapsed whitespace runs.
- `npm test` runs both suites with Node's built-in test runner (no test deps).
- Local smoke test: `scripts/dev-server.mjs` serves `public/` and routes `/api/*`
  to the real handlers, so the full flow can be exercised without deploying.

## 7. Decision log

| Date | Decision | Why |
| --- | --- | --- |
| 2026-11-19 | Timeline via availability-API anchors, not CDX | CDX returned empty/hung from the build environment; anchor sampling is fast, parallel, and degrades gracefully |
| 2026-11-19 | Audit split: extract server-side, check client-chunked | Keeps every function call under the 10s Hobby limit on link-heavy pages |
| 2026-11-19 | Zero npm dependencies, no build step | Deploy reliability + judges can read the whole repo quickly |
| 2026-11-19 | Reader endpoint restricted to `web.archive.org` | Prevents the endpoint from becoming a general-purpose open proxy |
| 2026-11-19 | `extractReadable` detects meta-refresh redirects | The GeoCities 2019 snapshot is a pure redirect page (zero visible text); the reader now surfaces the redirect target instead of showing an empty page |
