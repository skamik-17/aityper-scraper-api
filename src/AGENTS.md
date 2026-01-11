# BACKEND SRC KNOWLEDGE BASE

## OVERVIEW
Core backend source tree and service boundaries.

## STRUCTURE
```
src/
├── config/        # Env and runtime config
├── data/          # Market and team data
├── middleware/    # Express middleware
├── repositories/  # Supabase access
├── routes/        # API routing
├── scrapers/      # Playwright scrapers
├── services/      # Orchestration and normalization
├── types/         # Backend types
├── utils/         # Shared helpers
└── scripts/       # Debug and analysis tools
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Config | `backend/src/config/` | ENV validation and constants |
| Scraper orchestration | `backend/src/services/` | Scheduler and scraper service |
| Normalization | `backend/src/services/normalization/` | Bookmaker-specific normalizers |
| Data registry | `backend/src/data/market-catalog.ts` | Market definitions |

## CONVENTIONS
- Keep DB logic in repositories; keep orchestration in services.
- Use backend types from `backend/src/types/`.

## ANTI-PATTERNS
- Avoid business logic inside repositories.
- Do not bypass normalization before saving markets.
