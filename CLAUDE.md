# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AITyper Scraper API is the scraping and odds API service for AITyper, a betting odds
comparison platform for the Polish market. It scrapes odds across 14 Polish bookmakers
(STS, Fortuna, Betclic, Superbet, LVBet, Fuksiarz, etc.), normalizes them to a shared
market catalog, and serves them over a REST API.

This repo is the backend counterpart of the
[`aityper`](https://github.com/skamik-17/aityper) frontend repo. The two communicate
**only** over HTTP - there is no shared code, no shared `node_modules`, and no direct
file imports between them. Changing this repo's internal structure never requires a
frontend change unless it also changes a response shape the frontend depends on.

**Supported Leagues**: Ekstraklasa, Premier League, La Liga, Serie A, Ligue 1

## Architecture

```
┌─────────────────┐     HTTP API      ┌─────────────────────┐
│  aityper         │◄─────────────────►│  aityper-scraper-api│
│  (frontend repo) │  NEXT_PUBLIC_     │  (this repo)         │
│  Next.js, :3000  │  BACKEND_URL      │  Express, :3001      │
└──────────────────┘                   └──────────┬───────────┘
                                                    │ Playwright
                                                    │ (14 scrapers)
                                               ┌────▼────┐
                                               │ Supabase│
                                               │   DB    │
                                               └─────────┘
```

- **Hot reload enabled**: Changes to TypeScript files automatically recompile and restart the server (`tsx watch`).
- 14 Playwright scrapers live in `src/scrapers/bookmakers/`.
- Scheduled scraping via `node-cron` (default every 30 minutes, see `SCRAPE_INTERVAL_MINUTES`).
- Stores odds in Supabase; exposes a REST API for the frontend to consume.

## Development Commands

```bash
npm run dev          # Start Express + scrapers (port 3001), hot reload
npm run dev:stack    # Check/start local Supabase, then npm run dev (-- --check: probe only; -- --no-scrapers)
npm run build        # TypeScript compile to dist/
npm run start         # Run the compiled build
npm run test          # Vitest watch mode
npm run test:run       # Vitest single run (CI)
npm run test:coverage  # Vitest with coverage report
npm run db:migrate -- <file>   # Apply ONE migration (./scripts/apply-migrations.sh <file>; --all re-runs 01..N, never against a live DB)
```

## Local Supabase

The API reads and writes the local Supabase stack (`SUPABASE_URL`, PostgREST on
`http://127.0.0.1:54321`). A scrape run refuses to start while the database is unreachable.

- **Start procedure:** `npm run dev:stack` (`bash scripts/dev-stack.sh [--check] [--no-scrapers]`).
  It loads `.env` (variables already in the environment win) and probes `market_types`
  through PostgREST; only HTTP 200 counts as up. It exits 1 if the API already answers on
  `:${PORT:-3001}`. When a local stack is down, it `docker start`s the stopped
  `com.supabase.cli.project=backend` containers (except `edge_runtime`). When no such
  container exists (e.g. after `supabase stop`), it runs `supabase start` with CLI 2.70.5:
  the copy already under `~/.npm/_npx/*/node_modules/supabase` when there is one (works
  offline), otherwise `npx --yes supabase@2.70.5 start`. npx keys its cache on the raw
  argument, so that pinned spec does not reuse a bare `npx supabase` cache: its first run
  needs network access (npm registry plus a ~56 MB CLI download from GitHub). It then waits
  up to 90 s for HTTP 200 and execs `npm run dev`. `--no-scrapers` sets `SCRAPERS_ON=false`.
- **Check only:** `npm run dev:stack -- --check` prints
  `Supabase reachable at <url> (market_types HTTP 200)` and exits 0, or
  `Supabase NOT reachable at <url> (HTTP <code>)` and exits 1. It starts nothing.
- **Migrations:** apply exactly one file, e.g.
  `npm run db:migrate -- 11_scraper_runs_observability.sql`. Without an argument the script
  prints its usage line and exits 2; `--all` re-runs 01..N and must never be used against a
  live DB.
- **Scraper health:** `npx tsx scripts/scraper-status.ts [--league <slug>] [--json]` prints
  each bookmaker's last run status (exit 1 at the failure threshold, 2 when the DB is
  unreachable). `npx tsx scripts/smoke-bookmaker.ts --bookmaker <bm> [--persist]` scrapes one
  bookmaker: dry by default; `--persist` writes to the DB and exits 3 when it is unreachable.

## Key Configuration Files

- `src/config/index.ts` - runtime config (enabled leagues, bookmakers, scrape intervals)
- `src/data/market-catalog.ts` - single source of truth for canonical market codes,
  labels, view types, and selection vocabularies
- `src/data/` - canonical team names per league, used for team-name normalization

## Scraper Architecture

Every scraper implements `FullOfferScraper` (`src/scrapers/shared/scraper-contract.ts`):

```typescript
interface FullOfferScraper {
  readonly bookmaker: PolishBookmaker;
  scrapeFullOffer(league: string, budget?: ScrapeBudget): Promise<FullOfferScraperResult>;
  cleanup(): Promise<void>;
}
```

Transports: `HttpScraper` (`src/scrapers/base/http-scraper.ts`; the /rest/market family in
`src/scrapers/shared/rest-market/`, fortuna, superbet, lvbet), betclic's gRPC-web client, and
`PlaywrightScraper` (`src/scrapers/base/playwright-base.ts`) for the browser paths. A scraper
that can list its events cheaply also implements `IncrementalScraper`
(`src/scrapers/shared/incremental/incremental-scraper.ts`: `listEvents` + `fetchEvent`), and its
full pass is exactly those two, so incremental passes (plan 10, `INCREMENTAL_BOOKMAKERS`) fetch
only the due details. The aggregator (`src/scrapers/aggregator.ts`) runs one job per bookmaker
under the RunCoordinator; `getScraper(bm)` returns the picked instance.

The legacy 1X2 methods (`scrapeLeague`, `scrapeMatch`, `scrapeMatchDetails`, `extractEventUrls`)
and their result types are deleted; never add them back
(`src/scrapers/__tests__/legacy-path.test.ts` guards this).

### Adding a New Scraper
1. Create `src/scrapers/bookmakers/{bookmaker}/` with a pure mapping (listing + detail payload →
   `FullMatchOffer`) and its tests on recorded payloads
2. Implement `FullOfferScraper` (prefer `HttpScraper`; add `IncrementalScraper` when the listing
   carries kickoff and prices), declaring `readonly transport`
3. Add the league ids in `src/config/leagues.ts`
4. Export the picked instance in `src/scrapers/bookmakers/index.ts`
5. Register it in the `SCRAPERS` map in `aggregator.ts`

## Team Name Normalization

`team-matcher.ts` (`src/scrapers/team-matcher.ts`) normalizes bookmaker team names to canonical forms:

1. **Explicit aliases** - Handles known abbreviations (e.g., "Man Utd" → "Manchester United")
2. **Normalized matching** - Removes diacritics, lowercase comparison
3. **Fuzzy matching** - Fuse.js as fallback

Canonical teams are defined per league in `src/data/` (e.g., `premier-league-teams.ts`).

## Market Types & Catalog

`src/data/market-catalog.ts` is the single source of truth for every canonical market
code this service knows about (`MATCH_WINNER`, `TOTAL_GOALS`, `BTTS`, ...), their
selection vocabularies, labels, and view types. The frontend repo does **not** import
this file - it gets the same metadata over HTTP via `/api/odds/market-types`, so any
catalog change here is picked up by the frontend automatically without a frontend
deploy.

After adding or changing a catalog entry, run `npx tsx scripts/sync-market-types.ts` to
push the change into the `market_types` table - the `odds` table has a foreign key on
`market_type_id`, so a catalog entry that was never synced will silently fail every
insert that references it (see the `market_types` sync-gap note in the audit docs for
a real example of this failure mode).

## Normalization Pipeline

Bookmaker-specific normalizers under `src/services/normalization/bookmakers/` map each
bookmaker's raw market/selection names to the shared catalog codes. See
`src/services/normalization/index.ts` for the factory that dispatches to them.

## Language Requirements

- **Code and comments**: English only

## Git Commits

- **Only commit when explicitly requested** by the user
- Do NOT add signature footers (no "Generated with Claude Code", no "Co-Authored-By")
- Keep commit messages concise and descriptive

## Environment Variables

See [`.env.example`](.env.example) for the full, authoritative list. Required:
- `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` - Supabase project connection
- `ADMIN_API_KEY` - API key for admin endpoints (manual scrape triggers, run history)
- `CORS_ORIGIN` - origin allowed to call this API (the frontend's URL)
- `SCRAPE_INTERVAL_MINUTES` - scraping frequency (default: 30)
