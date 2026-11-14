# STS Scraper Module

## Overview
The STS scraper is a specialized module designed to extract real-time sports betting data from [sts.pl](https://www.sts.pl), Poland's largest bookmaker. Unlike traditional scrapers that rely on REST APIs or DOM parsing, this module utilizes **WebSocket interception** to capture the raw data stream directly from the bookmaker's live updates.

## Architecture
The module follows a highly decoupled design to handle the complexity of WebSocket-based data capture:

### Core Scrapers (`ws-scraper.ts`, `index.ts`, `offer-mapping.ts`)
`StsWsScraper` (`ws-scraper.ts`) is the default full-offer scraper: a direct Node WebSocket client, no browser (see **Transport** below). `StsBrowserScraper` (`index.ts`, still exported as `STSPlaywrightScraper` / `STSScraper`) inherits from `PlaywrightScraper` and captures the same frames from real sts.pl pages; it is the fallback behind `SCRAPER_TRANSPORT_STS=browser`. Both transports turn a listing fixture plus its frames into a `FullMatchOffer` through the one `mapStsFixtureToOffer` in `offer-mapping.ts`, which also owns the `[STS/FullOffer]` log lines `sts-run-check.py` parses. `createStsScraper()` in `index.ts` makes the pick once at module load; `bookmakers/index.ts` only re-exports `stsScraper`.

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

## Transport
**Default: one WebSocket session per league scrape** (`ws-scraper.ts`, protocol helpers in `ws-protocol.ts`). The client connects to `wss://www.sts.pl/sbk/api/sbk` with three headers (`origin`, a desktop Chrome `user-agent`, `accept-language`) and no cookies, then:
1. sends `{"t":1,"u":[{"s":"i_pl","n":0}]}` and `{"t":4}`, and waits up to 10 s for the `i_pl` snapshot (a header with `"f":1`; deltas never end the wait);
2. parses `i_pl` once, derives the fixtures with the same strict league filter as the browser path and logs `[STS/FullOffer] Found N fixtures for <league>`;
3. sends one `{"t":1,...}` that lists `i_pl` (kept) and every `f_<id>_pl` with `n:0`, and waits up to 5 s until every fixture has a snapshot;
4. re-sends once, with `n:0` only for the ids still missing (the others listed without `n`), and waits another 5 s;
5. skips any fixture still without a snapshot (the `No fixture snapshot ... skipping (previous snapshot kept)` line; no offer, so nothing written or pruned for it). 3 or more missing, or more than half, fail the run (`success: false`, no matches); fewer keep `success: true` with `error: "<missing> of <requested> details failed | ws timeout <ms>ms <url>"`;
6. logs `[STS/WS] Done in <ms>ms: <frames> frames, <bytes> bytes, <n> re-sent` and closes the session.

`{"t":5}` from the server is not an end-of-snapshots marker. Every wait is capped by the job budget, and an aborted budget opens no socket. The client never sends the browser's account subscriptions or requests.

**Fallback: the browser path.** Set `SCRAPER_TRANSPORT_STS=browser` in `.env` and restart the service (the pick is read once at module load). The browser path opens the league page and each match page in Chromium and records the same frames. Its circuit breaker stops the per-fixture loop after 3 consecutive fixtures without a snapshot (`Aborting per-fixture loop: 3 consecutive fixtures without a snapshot`) and fails the run with `<n> of <m> details failed | no fixture snapshot <url>`, so nothing is written or pruned.

**Operator signals.** A failed run logs `[sts] Full offer scraper error: <error>`; a blocking or protocol failure adds `[STS/WS] <kind> - set SCRAPER_TRANSPORT_STS=browser to use the browser path`.

| Log after `[sts] Full offer scraper error:` | `[STS/WS]` kind | Meaning | Operator action |
|---|---|---|---|
| `ws handshake HTTP 403 …` / `503 …` | blocked | Cloudflare challenges or blocks non-browser clients (browsers carry `cf_clearance`) | `SCRAPER_TRANSPORT_STS=browser` in `.env`, restart |
| `ws handshake HTTP 429 …` | blocked | edge rate limit | same, if the next run repeats it |
| `ws closed 1008 …` | blocked | policy close after the upgrade | flip |
| `no i_pl snapshot \| ws timeout …`, `<n> of <m> details failed \| ws timeout …` | protocol | upgrade accepted, subscriptions unanswered: the framing changed | flip; recapture with `evidence/sts-superbet/sts-probe.mjs` and diff against plan 05a Observations |
| `ws timeout <ms>ms …` (connect), `ws failed <code> …`, `ws closed 1006 …`, `ws handshake HTTP 502/504/52x …`, `scrape budget …` | transient | network or edge hiccup, or the run deadline | none; flip after 3 failed runs in a row (observability alert) |
| `No fixtures found for league`, preceded by `[STS] Strict id filter for premier-league (C1/T17) matched 0 fixtures; name-filter candidates: …` | (none; classified transient) | STS renumbered the league's category/tournament ids (the warning names the candidates), or the calendar is empty when it names none. Not a transport fault: the browser path uses the same filter | do **not** flip; move `LEAGUE_CONFIG["premier-league"]` to the named ids with a failing `parse-fixtures-tournament.test.ts` case first (sts.md OQ4). `sts-run-check.py` reports it as `strictIdMiss` |
| `<n> of <m> details failed \| no fixture snapshot <url>` (browser path) | (none) | 3 consecutive match pages without a fixture snapshot | none on the first run; investigate (site change) if it repeats |

## Key Features
*   **WebSocket Interception**: Captures high-frequency data frames (frames containing "s":"i_pl" and "s":"f_{id}_pl") for superior performance and reliability.
*   **Real-time Odds Capture**: Extracts live odds for both pre-match and active markets directly from the bookmaker's data bus.
*   **Modular Parsing**: Decoupled parsing logic allows for easier testing and maintenance of the complex STS data structure.
*   **Multi-league Support**: Configurable filters for major European football leagues.
*   **Advanced Market Support**: Handles everything from basic 1X2 to complex player-specific proposition bets.

## Supported Leagues
The scraper is pre-configured for major European football leagues via `LEAGUE_CONFIG`. Each league configuration includes a target URL, a numeric tournament ID, and string filters for country and tournament names to ensure high accuracy when filtering the global STS data stream.

*   **Ekstraklasa** (Poland): `tournamentId: 46`, Filters: "polska", "ekstraklasa".
*   **Premier League** (England): strict match on the ids `categoryId: 1` + `tournamentId: 17` (`strictTournamentId: true`); the name filters "angli", "premier league" stay as a second guard (alone they also match the Northern Premier League and Premier League 2 under category 249, "Anglia Amatorzy").
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
    *   `mapStsFixtureToOffer` (`offer-mapping.ts`): Turns one fixture plus its `f_{fixtureId}_pl` snapshot into a `FullMatchOffer` (all markets).
6.  **Team Matching**: Team names are normalized to canonical versions using the project's `team-matcher` utility to ensure database consistency.
7.  **Output**: The final data is returned as a `FullOfferScraperResult` (`success`, `matches: FullMatchOffer[]`, optional `error`).

## File Descriptions
| File | Responsibility |
| :--- | :--- |
| `index.ts` | `StsBrowserScraper` (extends `PlaywrightScraper`): the browser fallback full-offer scraper. Also `createStsScraper()` / `stsScraper`, the transport pick. |
| `ws-scraper.ts` | `StsWsScraper`: the default browserless full-offer scraper over one WebSocket session per league call. |
| `ws-protocol.ts` | Endpoint, headers, timeouts, subscription framing, the frame reducer, the snapshot breaker and the failure classification of the WebSocket path. |
| `offer-mapping.ts` | `mapStsFixtureToOffer` and the `[STS/FullOffer]` log lines, shared by both transports. |
| `navigation.ts` | Manages page interactions. Sets up `Page` event listeners for WebSocket frames and handles the cookie consent overlay. |
| `parser.ts` | Contains the complex tree-traversal logic for the STS data structure. Extracts fixtures and every market of a fixture. |
| `constants.ts` | Central repository for all static configuration: URLs, WS patterns, market IDs, league-specific filters, and timeouts. |
| `outcome-map.ts` | Provides a lookup table for outcome IDs. Essential because STS WebSocket frames often omit selection names for standard outcomes. |
| `types.ts` | TypeScript definitions for the internal STS WebSocket protocol, including categories, tournaments, fixtures, and markets. |

## Usage Examples

### Scraping a Full League
```typescript
import { stsScraper } from "./scrapers/bookmakers/sts/index.js";

// The picked transport: StsWsScraper unless SCRAPER_TRANSPORT_STS=browser
const result = await stsScraper.scrapeFullOffer("ekstraklasa");
if (result.success) {
  console.log(`Scraped ${result.matches.length} matches from Ekstraklasa`);
}
```

### One Match's Markets
```typescript
const match = result.matches.find((m) => m.homeTeam === "Lech Poznań");
for (const market of match?.markets ?? []) {
  console.log(market.name, market.selections.map((s) => `${s.name} ${s.odds}`).join(" / "));
}
```

### Forcing the Browser Fallback
```typescript
import { StsBrowserScraper } from "./scrapers/bookmakers/sts/index.js";

// Same FullOfferScraper contract, captured from real sts.pl pages
const viaBrowser = await new StsBrowserScraper().scrapeFullOffer("premier-league");
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
