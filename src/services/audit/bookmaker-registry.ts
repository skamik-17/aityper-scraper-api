import type { FullOfferCapableScraper } from "./scraper-audit-core.js";
import type { BookmakerMarketNormalizer } from "../normalization/types.js";

import { fortunaScraper } from "../../scrapers/bookmakers/fortuna/index.js";
import { superbetScraper } from "../../scrapers/bookmakers/superbet/index.js";
import { lvbetScraper } from "../../scrapers/bookmakers/lvbet/index.js";
import { fuksiarzScraper } from "../../scrapers/bookmakers/fuksiarz/index.js";
import { betcrisScraper } from "../../scrapers/bookmakers/betcris/index.js";
import { betfanScraper } from "../../scrapers/bookmakers/betfan/index.js";
import { bettersScraper } from "../../scrapers/bookmakers/betters/index.js";
import { etotoScraper } from "../../scrapers/bookmakers/etoto/index.js";
import { forbetScraper } from "../../scrapers/bookmakers/forbet/index.js";
import { lebullScraper } from "../../scrapers/bookmakers/lebull/index.js";
import { pzbukScraper } from "../../scrapers/bookmakers/pzbuk/index.js";
import { totalbetScraper } from "../../scrapers/bookmakers/totalbet/index.js";

import { fortunaNormalizer } from "../normalization/bookmakers/fortuna-normalizer.js";
import { superbetNormalizer } from "../normalization/bookmakers/superbet-normalizer.js";
import { lvbetNormalizer } from "../normalization/bookmakers/lvbet-normalizer.js";
import { fuksiarzNormalizer } from "../normalization/bookmakers/fuksiarz-normalizer.js";
import { betcrisNormalizer } from "../normalization/bookmakers/betcris-normalizer.js";
import { betfanNormalizer } from "../normalization/bookmakers/betfan-normalizer.js";
import { bettersNormalizer } from "../normalization/bookmakers/betters-normalizer.js";
import { etotoNormalizer } from "../normalization/bookmakers/etoto-normalizer.js";
import { forbetNormalizer } from "../normalization/bookmakers/forbet-normalizer.js";
import { lebullNormalizer } from "../normalization/bookmakers/lebull-normalizer.js";
import { pzbukNormalizer } from "../normalization/bookmakers/pzbuk-normalizer.js";
import { totalbetNormalizer } from "../normalization/bookmakers/totalbet-normalizer.js";

interface AuditTarget {
  scraper: FullOfferCapableScraper;
  normalizer: BookmakerMarketNormalizer;
}

// STS and Betclic are intentionally excluded — they have bespoke prep scripts.
const REGISTRY: Record<string, AuditTarget> = {
  fortuna: { scraper: fortunaScraper, normalizer: fortunaNormalizer },
  superbet: { scraper: superbetScraper, normalizer: superbetNormalizer },
  lvbet: { scraper: lvbetScraper, normalizer: lvbetNormalizer },
  fuksiarz: { scraper: fuksiarzScraper, normalizer: fuksiarzNormalizer },
  betcris: { scraper: betcrisScraper, normalizer: betcrisNormalizer },
  betfan: { scraper: betfanScraper, normalizer: betfanNormalizer },
  betters: { scraper: bettersScraper, normalizer: bettersNormalizer },
  etoto: { scraper: etotoScraper, normalizer: etotoNormalizer },
  forbet: { scraper: forbetScraper, normalizer: forbetNormalizer },
  lebull: { scraper: lebullScraper, normalizer: lebullNormalizer },
  pzbuk: { scraper: pzbukScraper, normalizer: pzbukNormalizer },
  totalbet: { scraper: totalbetScraper, normalizer: totalbetNormalizer },
};

export function getBookmakerAuditTargets(bm: string): AuditTarget | null {
  return REGISTRY[bm] ?? null;
}
