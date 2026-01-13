# AITyper Backend

## Overview
The AITyper backend is a robust Express.js application designed to scrape, normalize, and store betting odds from 14 major Polish bookmakers. It utilizes Playwright for browser automation, a custom-built normalization pipeline to standardize disparate market data, and Supabase for persistent storage. The system is designed for high reliability, featuring a shared browser pool, intelligent retry logic, and comprehensive health monitoring.

## Tech Stack
- **Core Framework**: Express.js
- **Browser Automation**: Playwright
- **Database**: Supabase (PostgreSQL)
- **Language**: TypeScript
- **Scheduling**: node-cron
- **Testing**: Vitest
- **Logging**: Winston
- **Orchestration**: NodeNext ESM

## Project Structure
```
backend/
├── src/
│   ├── config/           # Environment validation and runtime constants
│   ├── data/             # Market catalog, team registries, and bookmaker market maps
│   ├── middleware/       # Auth (API keys) and global error handling
│   ├── repositories/     # Data access layer for Supabase (Odds, Runs, Full Offer)
│   ├── routes/           # Express API endpoints grouped by domain
│   ├── scrapers/         # Playwright-based scraping engine
│   │   ├── base/         # Shared base class and browser pool management
│   │   └── bookmakers/   # Individual scraper implementations for 14 bookmakers
│   ├── services/         # Business logic, normalization pipeline, and scheduling
│   ├── types/            # TypeScript definitions for the entire backend
│   └── utils/            # Team matching, market aggregation, and shared helpers
├── scripts/              # Migration helpers, database analysis, and debug tools
├── supabase/
│   └── migrations/       # SQL migration files for database schema
├── data/                 # Local JSON cache and analysis output
├── package.json          # Dependency and script definitions
├── tsconfig.json         # TypeScript configuration
└── vitest.config.ts      # Test suite configuration
```

## Architecture
The backend follows a clean, layered architecture to ensure separation of concerns, scalability, and maintainability:

1.  **API Layer (Routes)**: Handles incoming HTTP requests, validates input using TypeScript interfaces, and routes to appropriate services. Implements authentication via `ADMIN_API_KEY` for sensitive operations.
2.  **Service Layer**: The brain of the application. It orchestrates complex workflows such as the scraping lifecycle, normalization of disparate data sources, and team matching.
3.  **Scraper Layer**: A specialized engine for browser automation. It handles the nuances of different bookmaker websites, including SPAs, WebSocket-heavy sites (STS), and traditional HTML rendered pages.
4.  **Repository Layer**: Encapsulates all data access logic. It abstracts Supabase-specific implementation details from the business logic, providing a clean API for CRUD operations on odds, runs, and metadata.
5.  **Database Layer**: Hosted on Supabase, it leverages PostgreSQL's power for complex market aggregations, time-based cleanup, and real-time data access through optimized views.

## Supported Bookmakers
The system provides full coverage for 14 licensed Polish bookmakers:
- **STS**: High-performance scraper using WebSocket interception.
- **Fortuna**: Standard Playwright navigation and parsing.
- **Superbet**: Efficient scraping via API-like data extraction.
- **Betclic**, **LVBet**, **Fuksiarz**, **Betfan**, **Totalbet**, **Forbet**, **Etoto**, **Betters**, **Lebull**, **Betcris**, **Pzbuk**.

## Supported Leagues
Odds are currently scraped and normalized for the following football leagues:
- Ekstraklasa (Poland)
- Premier League (England)
- LaLiga (Spain)
- Serie A (Italy)
- Ligue 1 (France)

## Scraper System
### Base Architecture
All scrapers extend the `PlaywrightScraper` base class, which provides standardized methods:
- `scrapeLeague()`: Entry point for league-wide odds extraction.
- `scrapeMatchDetails()`: Deep dive into a specific match for expanded markets (players, stats).
- `autoScroll()` & `waitForNetworkIdle()`: Utilities for handling dynamic content.

### Implementation Strategies
- **WebSocket Interception (STS)**: STS uses WebSockets for real-time updates. The backend includes a specialized sniffer that intercepts these messages to extract data without heavy DOM parsing.
- **Dynamic API Capture**: Some bookmakers (like Superbet and Betclic) are scraped by intercepting their internal XHR/Fetch calls, which is significantly faster and more reliable than DOM scraping.
- **Aggregator Pattern**: The `ScraperAggregator` runs all enabled bookmaker scrapers in parallel, collecting results into a unified format.

### Browser Pool
To optimize resource usage, the `BrowserPool` manages multiple Playwright instances:
- **Instance Reuse**: Keeps browsers warm to reduce startup latency.
- **Zombie Prevention**: Automatically kills stalled processes.
- **Resource Limits**: Ensures the server doesn't exceed memory/CPU thresholds.

## Normalization Pipeline
The normalization system is the core competitive advantage of the AITyper backend. It solves the "babel" problem of betting data, where every bookmaker uses different names for the same markets.

### Adapter-First Architecture
Instead of a monolithic switch statement, the system uses a factory-based adapter pattern:
- **Normalization Factory**: Routes raw market data to the appropriate bookmaker normalizer.
- **Bookmaker Normalizers**: Specialized classes (e.g., `StsNormalizer`, `FortunaNormalizer`) that understand the specific quirks of their source. They map local market names (e.g., "Wynik meczu (1x2)") to canonical codes (`MATCH_WINNER`).
- **Selection Normalizer**: A shared utility that standardizes selection names (e.g., mapping "1", "Gospodarz", "Home" all to `HOME`).

### Market Catalog
The `src/data/market-catalog.ts` serves as the single source of truth for the entire system (both frontend and backend). It defines:
- **Canonical Codes**: Unique identifiers like `TOTAL_GOALS` or `BTTS`.
- **Metadata**: Labels in multiple languages, display order, and categorization.
- **Validation**: Rules for parameters (e.g., valid goal lines) and required selections.

### Team Matching
A critical component of the pipeline is the `TeamMatcher`. It uses **Fuse.js** for fuzzy string matching to align bookmaker-specific team names (e.g., "Manc. City" vs "Manchester City") to a canonical team registry, ensuring that odds from all sources are grouped under the correct match.

## Market Categories
Markets are organized into the following logical categories:
- **WYNIK_MECZU (Match Result)**: 1X2, Double Chance, Draw No Bet.
- **GOLE (Goals)**: Total Goals (Over/Under), BTTS, Clean Sheet, Team Goals.
- **HANDICAP**: Asian and European Handicaps.
- **PIERWSZA_POLOWA (Half Time)**: HT Result, HT Goals, HT BTTS.
- **DOKLADNY_WYNIK (Correct Score)**: Exact score grid mapping.
- **ZAWODNICY (Players)**: Goalscorers, cards, shots, assists.
- **STATYSTYKI (Stats)**: Corners, cards, fouls, offsides.
- **KOMBINACJE (Combos)**: Result + BTTS, Result + Total Goals.

## API Endpoints
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/health` | System status, DB health, scheduler info | No |
| GET | `/api/odds` | Latest odds for all matches in a league | No |
| GET | `/api/odds/match` | Odds for specific match (home/away params) | No |
| GET | `/api/odds/match/full-offer` | Market comparison across all bookmakers | No |
| GET | `/api/odds/market-types` | Canonical market definitions and metadata | No |
| GET | `/api/bookmakers` | Status and statistics for all bookmakers | No |
| GET | `/api/matches/:home/:away/normalized-markets` | Grouped markets by category | No |
| POST | `/api/admin/scrape` | Trigger a manual scrape of all bookmakers | Yes |
| GET | `/api/admin/runs` | Historical log of scraper runs | Yes |
| GET | `/api/admin/scrapers/health` | Detailed health metrics per bookmaker | Yes |

## Configuration
The following environment variables are required:
- `PORT`: Server port (default: 3001).
- `SUPABASE_URL`: Your Supabase project URL.
- `SUPABASE_SERVICE_KEY`: Service role key for database access.
- `ADMIN_API_KEY`: Key for accessing admin endpoints.
- `SCRAPERS_ON`: Boolean to enable/disable automated scraping.
- `SCRAPE_INTERVAL_MINUTES`: Frequency of automated scrapes.
- `SCRAPER_TIMEOUT_MS`: Maximum duration for a single bookmaker scrape.

## Scripts
- `npm run dev`: Start the server in development mode using `tsx`.
- `npm run build`: Compile TypeScript to JavaScript.
- `npm run start`: Run the compiled production build.
- `npm run test`: Execute the test suite using Vitest.
- `npm run test:coverage`: Generate a test coverage report.
- `npm run db:migrate`: Apply pending migrations to the Supabase database.

## Database
The system leverages Supabase (PostgreSQL) with a highly optimized schema:

### Performance & Scalability
- **Partitioning Strategy**: Older odds are automatically moved to historical tables or deleted via the `Daily Cleanup` job to keep the primary `odds` table lean.
- **Optimized Views**:
    - `latest_odds`: Returns only the most recent odds for active matches.
    - `market_comparison`: Groups odds by market type across all bookmakers for side-by-side comparison.
- **Migrations**: 11 SQL migrations manage the evolution of the schema.

## Scheduler
The `SchedulerService` manages background tasks:
- **Initial Scrape**: Triggered 5 seconds after server boot if `SCRAPERS_ON` is true.
- **Periodic Scrape**: Runs at configurable intervals (default 60 minutes) via `node-cron`.
- **Daily Cleanup**: Executes at 3:00 AM daily to remove expired odds and optimize database performance.

## Getting Started

### Prerequisites
- Node.js 20+
- npm 10+
- Supabase account and project
- Playwright browsers (`npx playwright install chromium`)

### Installation
1.  Clone the repository and navigate to the backend:
    ```bash
    cd backend
    npm install
    npx playwright install chromium
    ```

2.  Configure environment variables:
    ```bash
    cp .env.example .env
    # Edit .env with your Supabase and API keys
    ```

3.  Initialize the database:
    ```bash
    npm run db:migrate
    ```

4.  Start development server:
    ```bash
    npm run dev
    ```
