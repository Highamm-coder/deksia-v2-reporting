# Deksia V2 Reporting

Automated client-goal reporting. For each client it reads the **Smart Goal Tracker** (Google Sheet),
pulls actuals from **Meta Ads**, **Facebook Pages** (organic), **GA4**, and **CallRail**, evaluates
each tactic against its benchmark, and writes:

- **Google Sheets mirror tabs** (client-facing, monthly) — an exact clone of each goal tab with the
  **Status** and **Results** columns auto-filled.
- **Supabase** (`metric_snapshots`, daily) — a queryable time-series data layer for trends/dashboards.

## How it runs

The engine is a **Claude Code skill** (`.claude/skills/client-reporting/`) — a procedure an agent
follows, not a standalone app. It runs **on-demand** in Claude Code, or via a **scheduled routine**
(daily → Supabase, monthly → Sheets). The only standalone service is the self-hosted CallRail MCP
server in `callrail-mcp-server/`.

```
 Smart Goal Tracker ──read──►  client-reporting skill  ──► Sheets mirror tabs (monthly)
 (Google Sheet, 27 tabs)        parse → route → pull   ──► Supabase metric_snapshots (daily)
                                → evaluate → write
        sources pulled:  Meta Ads (MCP) · Facebook Pages + GA4 (Composio) · CallRail (MCP)
```

## Repo layout

| Path | What |
|---|---|
| `.claude/skills/client-reporting/` | The engine — `SKILL.md` + `references/{metric-catalog,parser,registry}.md` |
| `callrail-mcp-server/` | Self-hosted CallRail MCP server (TypeScript). See its `CONNECT.md`. |
| `supabase/migrations/` | Database schema — run on the Supabase project |
| `control-panel.html` | Connector-health UI (static snapshot) |
| `docs/` | Reference material |

## Cloud resources (shared state — NOT in this repo)

| Resource | ID |
|---|---|
| Goals workbook (Google Sheet, read-only) | `1pFJqF6rrgMFczU8F73XHBjslDbYg571fgCwlLJBx0mk` |
| Reporting workbook (mirror tabs + `_Reporting Config`) | `1TYLr0slqT4UXAWwKJLgsabqETfp8TpgO0426_awR5JA` |
| Supabase project (`deksia-reporting`) | `ykxauddrsnuwkvimkdhw` · https://ykxauddrsnuwkvimkdhw.supabase.co |
| CallRail master account | `ACC1f1e633474304b16b41941a520b5432a` |

Per-client account IDs (Meta / GA4 / Facebook Page / CallRail company) live in the `_Reporting Config`
tab of the Reporting workbook and are documented in `.claude/skills/client-reporting/references/registry.md`.

## Setup on a new machine

1. **Prereqs:** Node 18+, Claude Code, and access to the Deksia Google / Meta / CallRail / Supabase accounts.
2. **Clone** this repo.
3. **Local MCP servers** — declared in [`.mcp.json`](.mcp.json) (the project MCP wrapper); Claude Code
   prompts to enable them when you open the project. Each needs its backing service running/authed:
   - **CallRail** (`callrail-mcp-server/`, HTTP on `:3000`):
     ```bash
     cd callrail-mcp-server && npm install && npm run build
     cp .env.example .env          # set CALLRAIL_API_KEY (CallRail → Account Settings → API Keys)
     nohup env TRANSPORT=http PORT=3000 node dist/index.js > callrail-mcp.out.log 2>&1 & disown
     ```
     `.mcp.json` points `callrail` at `http://localhost:3000/mcp`. Detail in `callrail-mcp-server/CONNECT.md`.
   - **Google Analytics** (Google's official [`analytics-mcp`](https://github.com/googleanalytics/google-analytics-mcp), stdio via pipx):
     ```bash
     brew install pipx && pipx ensurepath           # or: python3 -m pip install --user pipx
     # auth via Application Default Credentials (read-only Analytics scope):
     gcloud auth application-default login \
       --scopes=https://www.googleapis.com/auth/analytics.readonly,https://www.googleapis.com/auth/cloud-platform
     export GOOGLE_PROJECT_ID=<gcp-project-id>       # a GCP project with the Analytics Data API enabled
     ```
     `.mcp.json` launches it as `pipx run analytics-mcp`. Tools: `get_account_summaries`, `get_property_details`,
     `run_report`, `run_realtime_report`, `run_funnel_report`, `get_custom_dimensions_and_metrics`,
     `list_google_ads_links`. Run **`get_account_summaries`** once to map each client's GA4 property ID into
     `_Reporting Config` / `client_sources` (closes the GA4 mapping gap on the coverage roadmap).
4. **Connect the cloud connectors** in Claude Code:
   - **Composio** toolkits (OAuth): `googlesheets`, `google_analytics` (Composio GA — fallback to the GA MCP above), `facebook`, `instagram`, `metaads`
   - **Meta Ads MCP** and **Supabase MCP**
5. **Supabase schema:** run the SQL in `supabase/migrations/` against the project (Supabase SQL editor,
   or `supabase db push` with the CLI). Use the existing `ykxauddrsnuwkvimkdhw` project, or create a new
   one and update the ID in `registry.md` + the skill.
6. **Run reporting:** in Claude Code, invoke the **client-reporting** skill. It reads `_Reporting Config`,
   pulls each active client's actuals, and writes mirror tabs and/or Supabase (`--target sheets|supabase|both`).
7. **Schedule** (optional, recommended): a **daily** routine running `client-reporting --target supabase`
   and a **monthly** routine for `--target sheets`. The routine's run environment must have all four
   connectors attached (incl. CallRail).

## Secrets — never commit

- **CallRail API key** → `callrail-mcp-server/.env` (git-ignored).
- Everything else authenticates via Claude Code's connector OAuth / MCP config — not files in this repo.

## Current status (2026-06)

Wave 1 built (Green Shield, ECH, Engelsma, Seven Apart, Thornapple). **Live:** Meta Ads, CallRail
(source-attributed), Google Sheets, Supabase. **Partial:** Facebook Pages — needs per-page
Business-Manager "Analyze" roles for most client pages (only ~3 of 15 readable today). **Pending:**
GA4 property-ID mapping, Google Ads connector (Phase 5), ambiguous-account resolution
(Moda / KTU Pash / Oleandri / Contingent), and mapping the remaining unmapped client tabs.
See `control-panel.html` and `registry.md` for the current matrix and open items.
