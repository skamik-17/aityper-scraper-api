# STS Scraper Module

## Overview
The STS scraper is a specialized module designed to extract real-time sports betting data from [sts.pl](https://www.sts.pl), Poland's largest bookmaker. Unlike traditional scrapers that rely on REST APIs or DOM parsing, this module utilizes **WebSocket interception** to capture the raw data stream directly from the bookmaker's live updates.

## Architecture
The module follows a highly decoupled design to handle the complexity of WebSocket-based data capture:

### Core Scraper (`index.ts`)
The `STSPlaywrightScraper` class inherits from `PlaywrightScraper`. It manages the high-level workflow, browser context, and data persistence. It utilizes a `ScraperCache` (specifically `eventsCache`) with a TTL optimized for event data to minimize redundant network requests during intensive scraping sessions.

### Browser Navigation (`navigation.ts`)
This module is the "eyes" of the scraper. It handles:
*   **Initial Setup**: Configuring WebSocket frame listeners before page navigation.
*   **Authentication & Consent**: Handling the "Akceptuj wszystkie" cookie consent dialog which otherwise blocks the view.
*   **Real-time Monitoring**: Using `waitForData` to poll the internal buffer until the required WebSocket frames are captured.
*   **URL Construction**: Generating SEO-friendly match URLs using the `buildEventUrl` and `slugify` helpers.

### Data Processing (`parser.ts` & `outcome-map.ts`)
The parsing layer is strictly separated from the browser layer. `parser.ts` takes raw string data and traverses the STS betting tree:
1.  **Sport Level**: Identifies football (ID 1).
2.  **Category Level**: Filters by country (e.g., "Polska").
3.  **Tournament Level**: Filters by league (e.g., "Ekstraklasa").
4.  **Fixture Level**: Extracts team names and start times.
5.  **Market Level**: Maps odds using the `P` object and `assocKey`.

`outcome-map.ts` acts as a dictionary for the thousands of possible outcome IDs used by STS. Since the WebSocket stream often omits selection names (e.g., sending only ID 1 instead of "Home"), this map is critical for data normalization.

## Key Features
*   **WebSocket Interception**: Captures high-frequency data frames (frames containing "s":"i_pl" and "s":"f_{id}_pl") for superior performance and reliability.
*   **Real-time Odds Capture**: Extracts live odds for both pre-match and active markets directly from the bookmaker's data bus.
*   **Modular Parsing**: Decoupled parsing logic allows for easier testing and maintenance of the complex STS data structure.
*   **Multi-league Support**: Configurable filters for major European football leagues.
*   **Advanced Market Support**: Handles everything from basic 1X2 to complex player-specific proposition bets.

## Supported Leagues
The scraper is pre-configured for major European football leagues via `LEAGUE_CONFIG`. Each league configuration includes a target URL, a numeric tournament ID, and string filters for country and tournament names to ensure high accuracy when filtering the global STS data stream.

*   **Ekstraklasa** (Poland): `tournamentId: 46`, Filters: "polska", "ekstraklasa".
*   **Premier League** (England): `tournamentId: 17`, Filters: "angli", "premier league".
*   **LaLiga** (Spain): `tournamentId: 8`, Filters: "hiszpan", "laliga". (Includes logic to exclude Segunda Division).
*   **Serie A** (Italy): `tournamentId: 23`, Filters: "wloch", "serie a".
*   **Ligue 1** (France): `tournamentId: 16`, Filters: "francj", "ligue 1".

The `parser.ts` module also implements specific exclusion rules for the Premier League to skip U21/U23 matches, Cup competitions, and lower-tier leagues (Championship, League 1, etc.) that might appear under the same country category.

## Supported Markets
The module supports a wide range of markets identified by their internal `MARKET_IDS`. The parser handles dynamic market lines and line values (e.g., total goal lines like 2.5, 3.5).

### Core Markets
*   **Match Result (1X2)**: Market ID 1. Traditional home/draw/away outcomes.
*   **Double Chance**: Market ID 10. (1X, X2, 12).
*   **Draw No Bet**: Market ID 11. Home or Away win with return on draw.
*   **Both Teams to Score (BTTS)**: Market ID 43. (Tak/Nie).

### Goals and Totals
*   **Total Goals (Decimal)**: Market ID 25. Standard over/under markets (0.5, 1.5, 2.5, etc.).
*   **Total Goals (Asian)**: Market ID 23. Integer lines with possible return (1.0, 2.0, 3.0, etc.).
*   **Team-Specific Goals**: Market IDs 47 (Home win to nil) and 48 (Away win to nil).
*   **First/Last Goal**: Market IDs 8 and 9.

### Time-Based Markets
*   **1st Half Result**: Market ID 71.
*   **1st Half Total Goals**: Market ID 82.
*   **1st Half BTTS**: Market ID 95.
*   **2nd Half Result**: Market ID 102.
*   **2nd Half Total Goals**: Market ID 112.

### Score and Combination Markets
*   **Correct Score**: Market ID 283. Mapping IDs 1783-1817 covering scores from 0:0 to 5:4.
*   **Half-time Correct Score**: Market IDs 101 and 124. Mapping IDs 160-169.
*   **HT/FT**: Market ID 58. Mapping IDs 138-146 for all 9 combinations.
*   **Result + BTTS**: Market ID 49.
*   **Result + Total Goals**: Market ID 51.

### Player Proposition Markets
The scraper identifies player-specific markets by parsing line names or outcome labels:
*   **Goalscorers**: First (52), Last (53), and Anytime (54) goalscorer.
*   **Player Performance**: Shots (1851), Shots on Target (1852), Passes (1853), Assists (1845), and Cards (1855).

## Data Flow
The data extraction pipeline is designed to be resilient and efficient:

1.  **Browser Initialization**: The scraper uses the shared Playwright browser pool from the `PlaywrightScraper` base class.
2.  **Navigation**: The `navigation.ts` module handles the `page.goto` call to the bookmaker's site.
3.  **WebSocket Capture**:
    *   `setupWebSocketCapture` attaches a listener to the `websocket` event on the Playwright page.
    *   It filters for the STS data stream endpoint (`/sbk/api/sbk`).
    *   It monitors `framereceived` events for messages containing subscription keys.
4.  **Buffering**: Captured frames are stored in a `WSCaptureResult` object. The scraper waits for the "initial data" frame (the largest frame containing the fixture list) to arrive.
5.  **Parsing Pipeline**:
    *   `parseWebSocketJson`: Extracts the raw JSON payload from the frame.
    *   `parseFixtures`: Traverses the JSON tree to find matches for the requested league.
    *   `extractOdds`: Maps specific market and outcome IDs to the fixture based on its internal STS ID.
6.  **Team Matching**: Team names are normalized to canonical versions using the project's `team-matcher` utility to ensure database consistency.
7.  **Output**: The final data is returned as a standardized result object (e.g., `ScraperResult`).

## File Descriptions
| File | Responsibility |
| :--- | :--- |
| `index.ts` | Extends `PlaywrightScraper`. Orchestrates the high-level scraping flow for leagues and individual matches. Implements caching via `ScraperCache`. |
| `navigation.ts` | Manages page interactions. Sets up `Page` event listeners for WebSocket frames and handles the cookie consent overlay. |
| `parser.ts` | Contains the complex tree-traversal logic for the STS data structure. Extracts fixtures, basic odds, and extended markets. |
| `constants.ts` | Central repository for all static configuration: URLs, WS patterns, market IDs, league-specific filters, and timeouts. |
| `outcome-map.ts` | Provides a lookup table for outcome IDs. Essential because STS WebSocket frames often omit selection names for standard outcomes. |
| `types.ts` | TypeScript definitions for the internal STS WebSocket protocol, including categories, tournaments, fixtures, and markets. |

## Usage Examples

### Scraping a Full League
```typescript
import { stsScraper } from "./scrapers/bookmakers/sts/index.js";

const result = await stsScraper.scrapeLeague("ekstraklasa");
if (result.status === "success") {
  console.log(`Scraped ${result.data.length} matches from Ekstraklasa`);
}
```

### Scraping Specific Match Details
```typescript
const url = "https://www.sts.pl/kursy/lech-poznan-legia-warszawa/f1234567";
const details = await stsScraper.scrapeMatchDetails(url);
if (details.status === "success") {
  const odds = details.data;
  console.log(`1X2: ${odds.market1X2.home} - ${odds.market1X2.draw} - ${odds.market1X2.away}`);
}
```

### Full Market Offer Extraction
```typescript
const fullOffer = await stsScraper.scrapeFullOffer("premier-league");
// Useful for deep analytics or building comprehensive market comparisons
```

## Technical Details
### WebSocket Interception
STS uses a custom protocol over WebSockets. The data is delivered in frames where the first line is a header (metadata) and the second line is a JSON string. The scraper specifically targets:
*   **Initial Data**: Subscription `i_pl`. Contains the main fixture list and primary 1X2/DC/BTTS/OU markets.
*   **Fixture Details**: Subscription `f_{fixtureId}_pl`. Contains all additional markets for a specific match.

### Implementation Notes
*   **Base Class**: Extends `PlaywrightScraper`, inheriting browser pool management and standardized error handling.
*   **Cache**: Uses `ScraperCache` to store fixture data, reducing the need for redundant navigations during multi-step scraping.
*   **Timeouts**:
    *   `REQUEST_TIMEOUT`: 30,000ms.
    *   `WS_DATA_TIMEOUT`: 12,000ms.
    *   `WS_POLL_INTERVAL`: 500ms.
*   **URL Helpers**: `buildEventUrl` and `extractFixtureIdFromUrl` ensure consistent navigation between league lists and detail pages.
*   **Slugging**: `slugify` function handles Polish diacritics removal (e.g., "ą" -> "a") for correct URL construction.
