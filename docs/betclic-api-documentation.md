# Betclic API Documentation

## Overview

Betclic uses a **gRPC-web** API for fetching market data. Unlike traditional REST APIs with JSON, Betclic transmits data using **Protocol Buffers** (protobuf) over HTTP with base64 encoding. This document provides comprehensive documentation for programmatically fetching all market data from Betclic.

**Key Architecture Points:**
- Single service endpoint for all market operations
- Binary Protocol Buffer encoding (not JSON)
- gRPC-web transport layer with base64 wrapping
- All market tabs use the same API endpoint with different request parameters

---

## API Endpoints

### Base Service URL

```
https://offering.begmedia.com/web/offering.access.api/offering.access.api.MatchService
```

### Available Methods

| Method | Full URL | Purpose |
|--------|----------|---------|
| `GetMatchesByCompetitionWithNotifications` | `/GetMatchesByCompetitionWithNotifications` | List all matches for a competition |
| `GetMatchWithNotification` | `/GetMatchWithNotification` | Fetch full market data for a single match |

### 1. Listing Matches Endpoint

**Full URL:**
```
POST https://offering.begmedia.com/web/offering.access.api/offering.access.api.MatchService/GetMatchesByCompetitionWithNotifications
```

**Purpose:** Returns all upcoming matches for a given competition (league) with basic 1X2 odds.

**Request Body:** Protobuf message with competition ID (see Request Encoding section)

**Response:** List of matches with match IDs, team names, and 1X2 odds

### 2. Match Details Endpoint

**Full URL:**
```
POST https://offering.begmedia.com/web/offering.access.api/offering.access.api.MatchService/GetMatchWithNotification
```

**Purpose:** Returns full market details for a specific match, including all market groups (tabs).

**Request Body:** Protobuf message with match ID

**Response:** Complete market data with all outcomes and odds

---

## Required Headers

All gRPC requests **must** include these headers to successfully receive data. Missing headers will result in CloudFront/CORS rejection.

```typescript
const GRPC_HEADERS: Record<string, string> = {
  // Content negotiation - REQUIRED
  "Content-Type": "application/grpc-web-text",
  "Accept": "application/grpc-web-text",
  
  // gRPC-web identifier
  "X-Grpc-Web": "1",
  
  // Betclic brand/platform identifiers - REQUIRED
  "X-Bg-Ref-Brand": "BETCLIC",
  "X-Bg-Ref-Platform": "DESKTOP",
  "X-Bg-Ref-Regulator-Zone": "PL",
  "X-Bg-Regulation": "PL",
  
  // CloudFront protection bypass - REQUIRED
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Origin": "https://www.betclic.pl",
  "Referer": "https://www.betclic.pl/",
};
```

### Header Explanation

| Header | Value | Required | Purpose |
|--------|-------|----------|---------|
| `Content-Type` | `application/grpc-web-text` | Yes | Indicates base64-encoded gRPC-web payload |
| `Accept` | `application/grpc-web-text` | Yes | Request base64-encoded response |
| `X-Grpc-Web` | `1` | Yes | gRPC-web protocol marker |
| `X-Bg-Ref-Brand` | `BETCLIC` | Yes | Betclic brand identifier |
| `X-Bg-Ref-Platform` | `DESKTOP` | Yes | Platform type (DESKTOP/MOBILE) |
| `X-Bg-Ref-Regulator-Zone` | `PL` | Yes | Regulatory zone (Poland) |
| `X-Bg-Regulation` | `PL` | Yes | Market regulation |
| `User-Agent` | Modern browser UA | Yes | CloudFront protection |
| `Origin` | `https://www.betclic.pl` | Yes | CORS requirement |
| `Referer` | `https://www.betclic.pl/` | Yes | CORS requirement |

---

## Request Encoding

### gRPC-web Frame Structure

All requests are wrapped in a gRPC-web frame before base64 encoding:

```
[1 byte: compression flag (0x00)] + [4 bytes: message length (big endian)] + [N bytes: protobuf message]
```

**Example (Listing Request):**
```typescript
function buildGrpcFrame(protobufMessage: Buffer): Buffer {
  const frame = Buffer.alloc(5 + protobufMessage.length);
  frame[0] = 0;  // Uncompressed
  frame.writeUInt32BE(protobufMessage.length, 1);  // Length
  protobufMessage.copy(frame, 5);  // Message
  return frame;
}

// Send as base64
const requestBody = frame.toString("base64");
```

### Protobuf Message Format

#### Listing Request (GetMatchesByCompetitionWithNotifications)

Field 1 contains the competition ID as a varint:

```typescript
// Protobuf: field 1 = competition ID (varint)
// Tag 0x08 = field number 1, wire type 0 (varint)
function buildListingRequest(competitionId: number): Buffer {
  return Buffer.from([0x08, ...encodeVarint(competitionId)]);
}

// Competition IDs
const COMPETITION_IDS = {
  "premier-league": 3,
  "ekstraklasa": 221,
  "laliga": 7,
  "serie-a": 6,
  "ligue-1": 4,
};
```

#### Match Details Request (GetMatchWithNotification)

Field 1 contains the match ID as a varint (can be very large - use BigInt):

```typescript
// Protobuf: field 1 = match ID (varint, BigInt)
// Tag 0x08 = field number 1, wire type 0 (varint)
function buildMatchDetailsRequest(matchId: string): Buffer {
  return Buffer.from([0x08, ...encodeBigVarint(BigInt(matchId))]);
}
```

### Varint Encoding

Protobuf uses variable-length integers (varints):

```typescript
function encodeVarint(n: number): number[] {
  const bytes: number[] = [];
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n);
  return bytes;
}

function encodeBigVarint(n: bigint): number[] {
  const bytes: number[] = [];
  while (n > 0x7fn) {
    bytes.push(Number(n & 0x7fn) | 0x80);
    n >>= 7n;
  }
  bytes.push(Number(n));
  return bytes;
}
```

---

## Response Structure

### Response Decoding

1. Receive base64-encoded response
2. Decode from base64
3. Extract gRPC frame header (5 bytes)
4. Parse protobuf message

```typescript
function decodeGrpcResponse(base64Data: string): Buffer {
  const decoded = Buffer.from(base64Data.replace(/[\r\n]/g, ""), "base64");
  
  // Skip 5-byte frame header
  if (decoded.length > 5) {
    const messageLength = decoded.readUInt32BE(1);
    return decoded.slice(5, 5 + messageLength);
  }
  return decoded.slice(5);
}
```

### Protobuf Field Numbers

Based on reverse-engineering, the key field numbers are:

```typescript
const PROTO_FIELDS = {
  // Root message
  ROOT_WRAPPER: 1,
  
  // Match fields
  MATCH_ENTRIES: 3,
  MATCH_ID: 1,
  MATCH_NAME: 2,
  MATCH_MARKETS: 9,
  
  // Market fields
  MARKET_OUTCOMES: 16,
  
  // Outcome fields
  OUTCOME_NAME_SHORT: 10,
  OUTCOME_NAME_LONG: 11,
  OUTCOME_ODDS: 12,
};
```

### Listing Response Structure

```
Root Message
└── Field 1: Wrapper
    └── Field 3: Match Entries (repeated)
        ├── Field 1: Match ID (varint, BigInt)
        ├── Field 2: Match Name (string: "HomeTeam - AwayTeam")
        └── Field 9: Markets (repeated)
            └── Field 16: Outcomes (repeated)
                ├── Field 10: Short Name (string)
                ├── Field 11: Long Name (string)
                └── Field 12: Odds (double, 64-bit)
```

### Match Details Response Structure

```
Root Message
└── Field 1: Wrapper
    ├── Field 1: Match Info
    │   └── Field 2: Match Name (string)
    └── Field 2: Market Groups (repeated)
        ├── Field 2: Group Name (string, e.g., "Wynik meczu")
        └── Fields 3-20: Markets (repeated)
            ├── Field 2: Market Name (string)
            └── Field 16: Outcomes (repeated)
                ├── Field 10: Short Name (string)
                ├── Field 11: Long Name (string)
                └── Field 12: Odds (double, 64-bit)
```

---

## Market Type Mapping

### Tab to Market Group Mapping

All tabs use the **same API endpoint** (`GetMatchWithNotification`). The response contains all market groups, and the UI filters by group name.

| Tab Name (Polish) | Tab Name (English) | Market Group Name | Market Types |
|-------------------|---------------------|-------------------|--------------|
| **Top** | Top | Various | Popular markets from all categories |
| **Wynik** | Result | `Wynik meczu` | 1X2, Double Chance, Draw No Bet |
| **Strzelcy** | Scorers | `Strzelcy goli` | Anytime, First/Last Goalscorer |
| **Gole** | Goals | `Gole` | Total Goals O/U, BTTS, Team Goals |
| **Metoda gola** | Goal Method | `Metoda gola` | First Goal Method, Last Goal Method |
| **Wynik / Handicap** | Result / Handicap | `Handicap` | Asian Handicap, European Handicap |
| **Statystyki** | Statistics | `Statystyki` | Corners, Cards, Shots, Fouls |

### Canonical Market Codes

| Market Name (Polish) | Canonical Code | Selections |
|---------------------|----------------|------------|
| Wynik meczu | `MATCH_WINNER` | HOME, DRAW, AWAY |
| Podwójna szansa | `DOUBLE_CHANCE` | HOME_OR_DRAW, DRAW_OR_AWAY, HOME_OR_AWAY |
| Obie drużyny strzelą | `BTTS` | YES, NO |
| Liczba goli | `TOTAL_GOALS` | OVER, UNDER + line (e.g., 2.5) |
| Dokładny wynik | `CORRECT_SCORE` | Score (e.g., "2-1") |
| Remis bez zakładu | `DRAW_NO_BET` | HOME, AWAY |
| Wynik 1 połowy | `HALF_TIME_RESULT` | HOME, DRAW, AWAY |
| Handicap azjatycki | `ASIAN_HANDICAP` | HOME, AWAY + line |
| Handicap europejski | `EUROPEAN_HANDICAP` | HOME, DRAW, AWAY + line |
| Strzelec bramki | `GOALSCORER_*` | Player names |

### Selection Name Patterns

```typescript
const OUTCOME_NAMES = {
  // 1X2
  DRAW: "Remis",
  DRAW_ALT: "Remis ",  // Sometimes has trailing space
  
  // BTTS
  YES: "Tak",
  NO: "Nie",
  
  // Double Chance patterns
  OR_DRAW_PATTERN: "lub remis",      // e.g., "Man City lub remis"
  DRAW_OR_PATTERN: "Remis lub",      // e.g., "Remis lub Liverpool"
  OR_PATTERN: "lub",                 // e.g., "Man City lub Liverpool"
  
  // Over/Under
  OVER_PREFIX: "Powyżej",            // e.g., "Powyżej 2,5"
  UNDER_PREFIX: "Poniżej",           // e.g., "Poniżej 2,5"
};
```

---

## Implementation Guide

### Complete Fetch Example

```typescript
import https from "https";

const GRPC_HEADERS = {
  "Content-Type": "application/grpc-web-text",
  "Accept": "application/grpc-web-text",
  "X-Grpc-Web": "1",
  "X-Bg-Ref-Brand": "BETCLIC",
  "X-Bg-Ref-Platform": "DESKTOP",
  "X-Bg-Ref-Regulator-Zone": "PL",
  "X-Bg-Regulation": "PL",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Origin": "https://www.betclic.pl",
  "Referer": "https://www.betclic.pl/",
};

async function fetchBetclicMatches(competitionId: number): Promise<Buffer> {
  // 1. Build protobuf request
  const protobuf = Buffer.from([0x08, ...encodeVarint(competitionId)]);
  
  // 2. Wrap in gRPC frame
  const frame = Buffer.alloc(5 + protobuf.length);
  frame[0] = 0;
  frame.writeUInt32BE(protobuf.length, 1);
  protobuf.copy(frame, 5);
  
  // 3. Send as base64
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "offering.begmedia.com",
      path: "/web/offering.access.api/offering.access.api.MatchService/GetMatchesByCompetitionWithNotifications",
      method: "POST",
      headers: GRPC_HEADERS,
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        const decoded = Buffer.from(data.replace(/[\r\n]/g, ""), "base64");
        resolve(decoded.slice(5));  // Skip frame header
      });
    });
    
    req.on("error", reject);
    req.write(frame.toString("base64"));
    req.end();
  });
}

async function fetchMatchDetails(matchId: string): Promise<Buffer> {
  const protobuf = Buffer.from([0x08, ...encodeBigVarint(BigInt(matchId))]);
  // ... same pattern as above with GetMatchWithNotification endpoint
}
```

### Parsing Strategy: Scan Algorithm

For robust parsing without a full .proto schema, use the **scan algorithm**:

```typescript
function extractAllOutcomes(buf: Buffer): Array<{name: string, odds: number}> {
  const outcomes = [];
  const seen = new Set<string>();
  
  // Scan for field 12 doubles (tag 0x61 = field 12, wire type 1)
  for (let i = 1; i < buf.length - 8; i++) {
    if (buf[i - 1] === 0x61) {
      const odds = buf.readDoubleLE(i);
      
      if (odds >= 1.01 && odds < 100 && isFinite(odds)) {
        // Search backwards for name (field 10: 0x52 or field 11: 0x5a)
        const searchStart = Math.max(0, i - 150);
        
        for (let j = i - 2; j >= searchStart; j--) {
          if ((buf[j] === 0x52 || buf[j] === 0x5a) && j + 1 < i) {
            const len = buf[j + 1];
            
            if (len > 0 && len < 60 && j + 2 + len <= i) {
              const name = buf.slice(j + 2, j + 2 + len).toString("utf8");
              
              if (/^[\x20-\x7E\xA0-\xFF\u0100-\uFFFF]+$/.test(name)) {
                const key = `${name.trim()}:${odds.toFixed(2)}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  outcomes.push({ name: name.trim(), odds });
                }
                break;
              }
            }
          }
        }
      }
    }
  }
  
  return outcomes;
}
```

---

## Rate Limiting & Best Practices

### Recommended Request Patterns

1. **Initial Scrape:** Fetch listing first, then batch match details
2. **Timeout:** Use 30 second timeout for gRPC streams (they may not auto-close)
3. **Retry Logic:** 3 attempts with exponential backoff (1s, 2s, 3s delays)
4. **Read Timeout:** Close stream after 5 seconds of data collection
5. **Batch Size:** Process ~10-20 matches per batch to avoid memory issues

### Common Issues

| Issue | Solution |
|-------|----------|
| Empty response | Check all required headers are present |
| 403 Forbidden | Update User-Agent, Origin, Referer headers |
| Timeout | gRPC streams stay open; implement read timeout |
| Garbled data | Ensure proper base64 decode and frame extraction |
| Large match IDs | Use BigInt for IDs > 2^53 |

---

## Competition IDs Reference

| League | Slug | Competition ID |
|--------|------|----------------|
| Premier League | `premier-league` | 3 |
| Ekstraklasa | `ekstraklasa` | 221 |
| La Liga | `laliga` | 7 |
| Serie A | `serie-a` | 6 |
| Ligue 1 | `ligue-1` | 4 |
| Champions League | `liga-mistrzow` | 8 |

---

## URL Patterns

### Match Page URL Format

```
https://www.betclic.pl/pilka-nozna-sfootball/{league-slug}/{home-team}-{away-team}-m{match-id}
```

**Example:**
```
https://www.betclic.pl/pilka-nozna-sfootball/liga-mistrzow-c8/slavia-praga-barcelona-m973861186342912
```

### Match ID Extraction

```typescript
function extractMatchIdFromUrl(url: string): string | null {
  const match = url.match(/m(\d+)$/);
  return match ? match[1] : null;
}
```

---

## Summary

### Key Takeaways

1. **Single Endpoint Architecture:** All market tabs use `GetMatchWithNotification` - no need for tab-by-tab navigation
2. **Binary Protocol:** gRPC-web with Protocol Buffers, not JSON
3. **Base64 Transport:** Request and response bodies are base64-encoded
4. **Frame Wrapping:** 5-byte gRPC frame header on all messages
5. **Scan Algorithm:** Parse by scanning for odds (double values) and finding associated names
6. **BigInt Match IDs:** Match IDs can exceed JavaScript's safe integer limit

### Files Reference

| File | Purpose |
|------|---------|
| `backend/src/scrapers/bookmakers/betclic/constants.ts` | URLs, headers, field numbers |
| `backend/src/scrapers/bookmakers/betclic/navigation.ts` | HTTP/gRPC transport layer |
| `backend/src/scrapers/bookmakers/betclic/parser.ts` | Protobuf parsing and market extraction |
| `backend/src/scrapers/bookmakers/betclic/types.ts` | TypeScript type definitions |
| `backend/src/services/normalization/bookmakers/betclic-normalizer.ts` | Market normalization |

---

**Document Created:** 2026-01-21
**Based On:** Network analysis from betclic-network-explorer.ts and existing scraper implementation
**Test Match:** Slavia Praga vs Barcelona (Champions League)
