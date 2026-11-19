# Requirements — REVENANT: Resurrect the Dead Web

> Feature spec for Kiroween 2026, category **Resurrection**.
> Spec written 2026-11-19, before implementation (spec-first, per Kiro's spec-driven workflow).
> Status: requirements approved by the builder; implementation tracked in `tasks.md`.

## Introduction

Every year, millions of web pages die. A Pew Research study found 38% of web pages
that existed in 2013 were gone a decade later, and link rot keeps eating citations,
bookmarks, and personal history. REVENANT resurrects dead links: paste any URL and
the app checks whether it is alive; if it is dead, REVENANT finds its last good
snapshot in the Internet Archive's Wayback Machine, shows its "tombstone" (when it
was born, when it died), and brings back a readable version of the page. A
graveyard audit mode scans any live page for dead outbound links, and a local
graveyard keeps every soul the user has revived.

No account, no API key, no fee. The only external dependency is the public,
keyless Internet Archive Wayback Machine API.

## Glossary

- **Dead link**: a URL that no longer returns a successful (2xx/3xx) HTTP response.
- **Snapshot**: a capture of a URL stored by the Wayback Machine, identified by a
  14-digit timestamp (`YYYYMMDDhhmmss`).
- **Tombstone**: the summary card for a dead URL: its domain, first-seen ("born")
  and last-seen ("died") snapshot years, and cause of death (HTTP status / error).
- **Resurrection**: the act of recovering a dead URL's closest snapshot and
  presenting it as a viewable, readable page.
- **Graveyard**: the user's local history of resurrections (browser localStorage).

## Requirements

### Requirement 1 — Single-URL resurrection

**User Story:** As a reader who clicked a dead link, I want to paste the URL and
get its archived version back, so I can still read what was there.

#### Acceptance Criteria

1. WHEN a user submits a URL THEN the system SHALL check whether the URL is alive
   with an HTTP request and report alive/dead within 10 seconds.
2. WHEN the URL is dead THEN the system SHALL query the Wayback Machine
   availability API for the closest snapshot and present its URL and capture date.
3. WHEN the URL is alive THEN the system SHALL still show its closest snapshot as
   a "still with us" record, without claiming it is dead.
4. WHEN no snapshot exists THEN the system SHALL say so plainly and SHALL NOT
   fabricate a snapshot URL.
5. WHEN the user opens a shared link of the form `#r=<encoded-url>` THEN the
   system SHALL automatically resurrect that URL on page load.

### Requirement 2 — Tombstone and life timeline

**User Story:** As a curious user, I want to see a dead page's life story, so the
resurrection feels like meeting a ghost, not reading a log line.

#### Acceptance Criteria

1. WHEN a snapshot exists THEN the system SHALL render a tombstone card showing
   the domain, the HTTP status or error that killed it, and its born/died years.
2. WHEN timeline data is available THEN the system SHALL show snapshot years
   sampled across the page's life (anchor years 2000–2025), each linking to its
   snapshot.
3. WHEN some timeline lookups time out THEN the system SHALL render the partial
   timeline and mark it incomplete, rather than failing the whole resurrection.

### Requirement 3 — View and read the resurrected page

**User Story:** As a user, I want to view the resurrected page and read its text
without pop-ups or clutter, so the content is actually usable again.

#### Acceptance Criteria

1. WHEN a snapshot exists THEN the system SHALL offer a "View snapshot" action
   that opens the archived page in an embedded viewer.
2. WHEN the user chooses "Reader view" THEN the system SHALL fetch the snapshot
   server-side, strip scripts/styles/navigation, and return readable title,
   headings, and text.
3. WHEN the reader endpoint is called with a non-`web.archive.org` URL THEN the
   system SHALL reject the request (SSRF guard: the reader only fetches archive
   hosts).

### Requirement 4 — Graveyard audit

**User Story:** As a blogger or maintainer, I want to paste one of my pages and
find every dead outbound link on it, so I can fix link rot before my readers hit it.

#### Acceptance Criteria

1. WHEN a user submits a page URL THEN the system SHALL fetch the page, extract
   its outbound links (capped at 60), and list them with internal/external marks.
2. WHEN the user starts the check THEN the system SHALL check the links in
   parallel batches and show progress, then a summary (total / alive / dead /
   dead percentage).
3. WHEN a link is dead THEN the system SHALL offer a one-click resurrect action
   for that link.

### Requirement 5 — Bulk check

**User Story:** As a researcher with a list of URLs, I want to check them all at
once, so I can triage a whole bibliography.

#### Acceptance Criteria

1. WHEN a user pastes up to 25 URLs THEN the system SHALL check all of them and
   return a per-URL alive/dead result with HTTP status.
2. WHEN a bulk URL is dead and has a snapshot THEN the result SHALL include the
   closest snapshot URL.
3. WHEN more than 25 URLs are submitted THEN the system SHALL reject the request
   with a clear limit message.

### Requirement 6 — The Graveyard (local history)

**User Story:** As a returning user, I want to see everything I have revived, so
my resurrections are not lost when I close the tab.

#### Acceptance Criteria

1. WHEN a resurrection succeeds THEN the system SHALL record it in browser
   localStorage (URL, snapshot URL, capture date, revived-at time).
2. WHEN the user opens the app THEN the system SHALL render the graveyard with a
   count of souls revived and a way to revisit or remove each entry.
3. WHEN localStorage is unavailable THEN the system SHALL keep working without
   history and SHALL NOT crash.

### Requirement 7 — Safety and honesty

**User Story:** As an operator, I want the app to be safe to run in public, so it
cannot be abused as an open proxy.

#### Acceptance Criteria

1. WHEN a submitted URL has no scheme THEN the system SHALL assume `https://`.
2. WHEN a submitted URL targets localhost, a private IP range, or a non-HTTP(S)
   scheme THEN the system SHALL reject it before any fetch.
3. WHEN an upstream request times out THEN the system SHALL return a partial,
   clearly-labelled result instead of hanging past the platform limit.
4. WHEN the Wayback Machine is unreachable THEN the system SHALL report the
   archive as unavailable and SHALL NOT invent snapshot data.

### Requirement 8 — Presentation

**User Story:** As a hackathon judge, I want a polished, coherent, memorable
product experience, so the app reads as a finished product, not a demo sketch.

#### Acceptance Criteria

1. WHEN the app loads THEN the system SHALL present a coherent graveyard theme
   (dark, fog, tombstones) that stays readable and responsive on mobile.
2. WHEN any operation runs THEN the system SHALL show loading, success, and error
   states; no action SHALL leave the user staring at a frozen screen.
3. WHEN the user has never used the app THEN the system SHALL offer one-click
   demo links to famous dead sites that are verified to have snapshots.
