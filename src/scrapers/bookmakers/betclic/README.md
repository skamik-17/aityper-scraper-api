# Betclic Scraper

## Overview

The Betclic scraper communicates directly with Betclic's **gRPC-web API** using Protocol Buffers. It does NOT use DOM scraping.

| Aspect | Other Scrapers | Betclic |
|--------|----------------|---------|
| Data Source | DOM / WebSocket | gRPC-web API |
| Transport | Playwright browser | Node.js HTTPS |
| Encoding | JSON/HTML | Protocol Buffers |
| Browser needed | Yes | No |

## File Structure

```
backend/src/scrapers/bookmakers/betclic/
├── index.ts          # Scraper class, orchestrates fetch + parse
├── navigation.ts     # gRPC transport, request building
├── parser.ts         # Protobuf parsing, market extraction
├── constants.ts      # API config, headers, filter IDs
└── types.ts          # TypeScript interfaces
```

## Current Performance (2026-01-24)

| Metric | Value |
|--------|-------|
| Markets per match | ~130 (after deduplication) |
| Raw markets (all tabs) | ~167 |
| Tabs fetched | 7 |
| Response time | ~8-10s per match |

## gRPC Protocol

### Endpoint
```
POST https://offering.begmedia.com/web/offering.access.api/offering.access.api.MatchService/GetMatchWithNotification
```

### Request Format
```
HTTP Body = Base64(Frame)
Frame = Flag[1 byte] + Length[4 bytes BE] + ProtobufMessage
```

### Required Headers
```typescript
{
  "Content-Type": "application/grpc-web-text",
  "Accept": "application/grpc-web-text",
  "X-Grpc-Web": "1",
  "X-Bg-Ref-Brand": "BETCLIC",
  "X-Bg-Ref-Platform": "DESKTOP",
  "X-Bg-Ref-Regulator-Zone": "PL",
  "Origin": "https://www.betclic.pl",
  "Referer": "https://www.betclic.pl/"
}
```

Missing headers result in HTTP 403.

## Multi-Tab Architecture

Betclic has 7 tabs with different market categories. Each tab requires a separate API request with a category filter.

### Tab Category IDs

| Tab | Category ID | Content |
|-----|-------------|---------|
| TOP | (no filter) | Popular markets |
| WYNIK | `ca_ftb_rslt` | Result markets |
| STRZELCY | `ca_ftb_gsc` | Goalscorer markets |
| GOLE | `ca_ftb_goa` | Goal markets |
| METODA_GOLA | `ca_ftb_goalm` | Goal method |
| HANDICAP | `ca_ftb_cshcp` | Handicap + Correct Score |
| STATYSTYKI | `ca_ftb_prp` | Statistics |

### Data Flow

```
scrapeFullOffer()
    │
    ▼
fetchAllMarketGroups(matchId)
    │
    ├─► Request with no filter (TOP)
    ├─► Request with ca_ftb_rslt (WYNIK)
    ├─► Request with ca_ftb_gsc (STRZELCY)
    └─► ... (7 requests total)
    │
    ▼
parseAllMarketsFromMultipleResponses()
    │
    ├─► parseAllMarketsFromProto() per response
    └─► deduplicate by name:type
    │
    ▼
ScrapedMarket[]
```

## Protobuf Parsing

The parser handles two different response structures:

### 1. TOP Tab (Flat Structure)
```
Field 11
└── Field 3: market
    ├── Field 2: name
    └── Field 16: selections (direct)
```

### 2. Other Tabs (Grouped Structure)
```
Field 11
├── Field 1: group_id (e.g., "subca_ftb_bgo")
├── Field 2: group_name (e.g., "Gole - popularne")
└── Field 3: market
    ├── Field 2: name
    └── Field 10 → Field 1 → Field 1: selections (nested)
```

### Key Functions

| Function | Purpose |
|----------|---------|
| `parseProtobuf()` | Recursive protobuf decoder |
| `extractMarketGroups()` | Handles both TOP and grouped structures |
| `extractMarket()` | Extracts market with selections |
| `inferMarketType()` | Maps Polish names to canonical types |

## Group IDs (Constant Across Matches)

```
WYNIK:
  subca_ftb_brs   = Wynik - popularne
  subca_ftb_dbcc  = Podwójna szansa
  subca_ftb_rsh   = Wynik & połowy
  subca_ftb_rsg   = Wynik & gole

STRZELCY:
  subca_ftb_mgs   = Wielu strzelców
  subca_ftb_gsas  = Strzelcy i asysty

GOLE:
  subca_ftb_bgo   = Gole - popularne
  subca_ftb_bot   = Obie drużyny
  subca_ftb_gbt   = Gole drużyny
  subca_ftb_gbh   = Gole w połowie

METODA_GOLA:
  subca_ftb_pen   = Rzut karny
  subca_ftb_hea   = Główka
  subca_ftb_frk   = Rzuty wolne

HANDICAP:
  subca_ftb_hcp   = Handicap
  subca_ftb_cos   = Dokładny wynik

STATYSTYKI:
  subca_ftb_crnr  = Rzuty rożne
  subca_ftb_sho   = Strzały
  subca_ftb_crd   = Kartki
  subca_ftb_fos   = Faule
  subca_ftb_ofs   = Spalone
```

## Normalization Patterns

### Market Name Patterns

| Polish Pattern | Canonical Type |
|----------------|----------------|
| `Wynik meczu (z wyłączeniem dogrywki)` | MATCH_WINNER |
| `Podwójna Szansa` | DOUBLE_CHANCE |
| `Oba zespoły strzelą gola` | BTTS |
| `Gole Powyżej/Poniżej` | TOTAL_GOALS |
| `Handicap` | EUROPEAN_HANDICAP |
| `Dokładny wynik` | CORRECT_SCORE |
| `Suma rzutów rożnych` | TOTAL_CORNERS |

### Selection Name Patterns

| Polish | Canonical |
|--------|-----------|
| `{HomeTeam}` | HOME |
| `Remis` or `Remis ` (with space!) | DRAW |
| `{AwayTeam}` | AWAY |
| `Tak` | YES |
| `Nie` | NO |
| `Powyżej X,Y` | OVER |
| `Poniżej X,Y` | UNDER |

### Number Format Quirk

**CRITICAL**: Handicap lines use inconsistent decimal separators!
- HOME team: comma (`Bournemouth (+0,5)`)
- AWAY team: dot (`Liverpool (+0.5)`)

Normalize both formats when parsing.

## Diagnostic Scripts

```bash
# Fetch and display all tabs
npx tsx scripts/betclic-grpc-to-clean-json.ts --match 905675290968064 --all

# Fetch single tab
npx tsx scripts/betclic-grpc-to-clean-json.ts --match 905675290968064 --tab STATYSTYKI

# Proto structure analysis
npx tsx scripts/betclic-market-discovery.ts --proto
```

## Troubleshooting

| Symptom | Cause | Solution |
|---------|-------|----------|
| HTTP 403 | Missing headers | Check GRPC_HEADERS in constants.ts |
| 0 markets | Wrong protobuf structure | Use `--proto` flag to inspect |
| Timeout | Large response | Increase REQUEST_TIMEOUT |
| BigInt error | Match ID overflow | Use encodeBigVarint() |

## Adding New Market Type

1. Add to `MARKET_TYPES` in `constants.ts`
2. Add pattern to `inferMarketType()` in `parser.ts`
3. Test: `npx tsx scripts/betclic-grpc-to-clean-json.ts --all`

## Testing

```bash
# Unit tests
npm run test -- betclic

# Integration test
npx tsx scripts/betclic-integration-test.ts
```

## Related Documentation

- `backend/docs/betclic-normalization-patterns.md` - Full normalization reference
- `backend/docs/betclic-tab-network-analysis.md` - HAR file analysis
- `docs/plans/betclic-parser-replacement.md` - Parser refactoring plan
