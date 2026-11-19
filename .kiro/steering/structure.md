---
inclusion: always
---

# Structure — REVENANT

```
revenant/
├── .kiro/
│   ├── specs/revenant/          # spec-first artifacts (this build's plan)
│   │   ├── requirements.md      # EARS requirements
│   │   ├── design.md            # architecture + decision log
│   │   └── tasks.md             # numbered implementation tasks
│   ├── steering/                # persistent project context
│   │   ├── product.md           # what the product is and who it serves
│   │   ├── tech.md              # stack, constraints, conventions
│   │   └── structure.md         # this file
│   ├── hooks/                   # event-driven automations (JSON, schema v1)
│   │   ├── run-tests.json       # PostFileSave on api/** or tests/** → npm test
│   │   └── check-syntax.json    # PostFileSave on public/*.js → node --check
│   └── settings/mcp.json        # MCP servers for Kiro sessions (fetch)
├── api/                         # Vercel Serverless Functions (CommonJS)
│   ├── _lib.js                  # shared helpers (tested)
│   ├── resurrect.js             # GET  ?url=
│   ├── check.js                 # POST {urls}
│   ├── audit.js                 # GET  ?url=
│   └── extract.js               # GET  ?url= (archive hosts only)
├── public/                      # static frontend, served as-is
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── scripts/
│   ├── dev-server.mjs           # local static + API server (no Vercel login needed)
│   └── hook-check-saved-file.mjs# helper for the check-syntax hook
├── tests/
│   ├── lib.test.js              # unit tests for api/_lib.js
│   └── property.test.js         # property-style tests, generated inputs
├── docs/
│   ├── KIRO_USAGE.md            # honest write-up of how Kiro was used
│   ├── SUBMISSION.md            # Devpost submission package (copy-ready)
│   └── DEMO_VIDEO_SCRIPT.md     # <3 min demo video script + shot list
├── AGENTS.md                    # agent instructions (read by Kiro and others)
├── package.json                 # zero deps; scripts: test, dev
├── vercel.json                  # functions config
├── .gitignore                   # NEVER ignores .kiro/
├── LICENSE                      # MIT
└── README.md
```

## Rules

- `.kiro/` is committed and never gitignored (Kiroween eligibility requires it).
- New features start as a spec under `.kiro/specs/<feature>/` (requirements →
  design → tasks) before code is written.
- Shared server logic goes in `api/_lib.js` with unit tests; endpoints stay thin.
- The frontend stays framework-free; if a second page is ever needed, it still
  lives in `public/` with no build step.
