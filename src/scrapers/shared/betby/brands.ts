/**
 * Per-brand Betby configuration. Pinned endpoints and both deep-link formats
 * were verified on 2026-11-06 (Leeds United - Tottenham Hotspur, 2725816334213586962).
 */
import { discoverBettersEndpoints, discoverLebullEndpoints } from "./discovery.js";
import type { BetbyBookmaker, BetbyBrandConfig } from "./types.js";

export const BETBY_BRANDS: Record<BetbyBookmaker, BetbyBrandConfig> = {
  betters: {
    bookmaker: "betters",
    logTag: "Betters",
    pinned: {
      prematchBase: "https://api-h-c7818b61-608.sptpub.com/api/v4",
      descriptionsBase: "https://api-h-c7818b61-608.sptpub.com/api/v3",
      brandId: "2658970707769307140",
    },
    discover: discoverBettersEndpoints,
    // Betby route /:sportSlug/:categorySlug/:tournamentSlug/:eventSlugAndId under /zaklady-sportowe.
    buildEventUrl: (ref) =>
      `https://www.betters.pl/zaklady-sportowe/soccer/${ref.categorySlug}/${ref.tournamentSlug}/${ref.eventSlug}-${ref.eventId}`,
  },
  lebull: {
    bookmaker: "lebull",
    logTag: "LeBull",
    pinned: {
      prematchBase: "https://betting-betby-secundus.prod.sbteam.xyz/v5",
      descriptionsBase: "https://betting-betby-secundus.prod.sbteam.xyz/v4",
      brandId: "2694137186776920067",
    },
    discover: discoverLebullEndpoints,
    // Route /event/:sportId/:countryId/:leagueId/:eventId of the lebull sportsbook (sb_host); sport 1 = soccer.
    buildEventUrl: (ref) =>
      `https://lebull-pl-bb.boxwebcdn.work/event/1/${ref.categoryId}/${ref.tournamentId}/${ref.eventId}`,
  },
};
