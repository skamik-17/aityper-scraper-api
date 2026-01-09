# BACKEND KNOWLEDGE BASE

## OVERVIEW
Express + Playwright backend for scraping and normalization.

## STRUCTURE
```
backend/
├── src/          # API, scrapers, services
├── scripts/      # DB and maintenance scripts
├── supabase/     # Local Supabase config
└── dist/         # Build output
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Server entry | `backend/src/index.ts` | Express app boot and scheduler |
| Routes | `backend/src/routes/` | API handlers |
| Scrapers | `backend/src/scrapers/` | Playwright scrapers + base |
| Services | `backend/src/services/` | Scrape orchestration and normalization |
| Repos | `backend/src/repositories/` | Supabase queries |

## CONVENTIONS
- NodeNext ESM; include `.js` extensions in imports.
- Scrapers extend `PlaywrightScraper` and use the browser pool.
- Normalize markets before persistence.

## ANTI-PATTERNS
- Do not add monolithic scrapers or legacy fallbacks.
- Avoid large DOM iteration in Playwright; capture once and parse.
