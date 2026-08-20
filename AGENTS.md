# AITYPER SCRAPER API - KNOWLEDGE BASE

## OVERVIEW
Express + Playwright service for scraping, normalizing, and serving Polish bookmaker
odds. Standalone repo, companion to the `aityper` frontend repo (communicates over
HTTP only - no shared code).

## STRUCTURE
```
.
├── src/          # API, scrapers, services
├── scripts/      # DB and maintenance scripts
├── supabase/     # Migrations and local Supabase config
└── dist/         # Build output (gitignored)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Server entry | `src/index.ts` | Express app boot and scheduler |
| Routes | `src/routes/` | API handlers |
| Scrapers | `src/scrapers/` | Playwright scrapers + base |
| Services | `src/services/` | Scrape orchestration and normalization |
| Repos | `src/repositories/` | Supabase queries |
| Market catalog | `src/data/market-catalog.ts` | Single source of truth for canonical market codes |

## CONVENTIONS
- NodeNext ESM; include `.js` extensions in imports.
- Scrapers extend `PlaywrightScraper` and use the browser pool.
- Normalize markets before persistence.

## ANTI-PATTERNS
- Do not add monolithic scrapers or legacy fallbacks.
- Avoid large DOM iteration in Playwright; capture once and parse.
