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
npm run build        # TypeScript compile to dist/
npm run start         # Run the compiled build
npm run test          # Vitest watch mode
npm run test:run       # Vitest single run (CI)
npm run test:coverage  # Vitest with coverage report
npm run db:migrate    # Apply Supabase migrations (./scripts/apply-migrations.sh)
```

## Key Configuration Files

- `src/config/index.ts` - runtime config (enabled leagues, bookmakers, scrape intervals)
- `src/data/market-catalog.ts` - single source of truth for canonical market codes,
  labels, view types, and selection vocabularies
- `src/data/` - canonical team names per league, used for team-name normalization

## Scraper Architecture

All scrapers extend `PlaywrightScraper` (`src/scrapers/base/playwright-base.ts`):

```typescript
abstract class PlaywrightScraper {
  abstract scrapeLeague(league: string): Promise<ScraperResult>;
  abstract scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult>;
  abstract extractEventUrls(page: Page): Promise<EventUrlEntry[]>;
  // Provides: initBrowser(), applyStealthScripts(), navigateWithRetry()
}
```

Each bookmaker scraper implements league-specific URL configs and parsing logic. The
`ScraperAggregator` (`src/scrapers/aggregator.ts`) runs all scrapers in parallel.

### Adding a New Scraper
1. Create `src/scrapers/bookmakers/{bookmaker}.ts`
2. Extend `PlaywrightScraper`, implement abstract methods
3. Add league URL configs with selectors
4. Export instance in `src/scrapers/bookmakers/index.ts`
5. Register in `SCRAPERS` map in `aggregator.ts`

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
