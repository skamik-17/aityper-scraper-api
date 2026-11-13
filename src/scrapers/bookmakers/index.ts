/**
 * Export all bookmaker scrapers
 *
 * All scrapers refactored to modular directory structure.
 *
 * Brands with a browserless path pick their transport here, once at module load
 * (README §3 single pick): HTTP by default, the browser class when
 * SCRAPER_TRANSPORT_<BM>=browser. A change needs a restart.
 */
import { getTransportOverride } from "../../config/transport.js";
import type { FullOfferScraper } from "../shared/scraper-contract.js";
import { EtotoBrowserScraper } from "./etoto/index.js";
import { EtotoHttpScraper } from "../shared/rest-market/brands/etoto.js";
import { ForbetBrowserScraper } from "./forbet/index.js";
import { ForbetHttpScraper } from "../shared/rest-market/brands/forbet.js";
import { FuksiarzBrowserScraper } from "./fuksiarz/index.js";
import { FuksiarzHttpScraper } from "../shared/rest-market/brands/fuksiarz.js";
import { BetfanBrowserScraper } from "./betfan/index.js";
import { BetfanHttpScraper } from "../shared/rest-market/brands/betfan.js";
import { FortunaBrowserScraper, FortunaHttpScraper } from "./fortuna/index.js";
import { SuperbetBrowserScraper, SuperbetHttpScraper } from "./superbet/index.js";
import { LVBetBrowserScraper, LVBetHttpScraper } from "./lvbet/index.js";

// Modular scrapers (refactored)
export { SuperbetBrowserScraper, SuperbetHttpScraper } from "./superbet/index.js";
export { EtotoBrowserScraper } from "./etoto/index.js";
export { EtotoHttpScraper } from "../shared/rest-market/brands/etoto.js";
export { ForbetBrowserScraper } from "./forbet/index.js";
export { ForbetHttpScraper } from "../shared/rest-market/brands/forbet.js";
export { lebullScraper, LebullPlaywrightScraper } from "./lebull/index.js";
export { FuksiarzBrowserScraper } from "./fuksiarz/index.js";
export { FuksiarzHttpScraper } from "../shared/rest-market/brands/fuksiarz.js";
export { BetfanBrowserScraper } from "./betfan/index.js";
export { BetfanHttpScraper } from "../shared/rest-market/brands/betfan.js";
export { betclicScraper, BetclicPlaywrightScraper } from "./betclic/index.js";
export { totalbetScraper, TotalbetPlaywrightScraper } from "./totalbet/index.js";
export { stsScraper, StsBrowserScraper, StsWsScraper, STSScraper, STSPlaywrightScraper } from "./sts/index.js";
export { betcrisScraper, BetcrisPlaywrightScraper } from "./betcris/index.js";
export { bettersScraper, BettersPlaywrightScraper } from "./betters/index.js";
export { pzbukScraper, PzbukPlaywrightScraper } from "./pzbuk/index.js";
export { LVBetBrowserScraper, LVBetHttpScraper } from "./lvbet/index.js";
export { FortunaBrowserScraper, FortunaHttpScraper } from "./fortuna/index.js";

export const etotoScraper: FullOfferScraper =
  getTransportOverride("etoto") === "browser" ? new EtotoBrowserScraper() : new EtotoHttpScraper();

export const forbetScraper: FullOfferScraper =
  getTransportOverride("forbet") === "browser" ? new ForbetBrowserScraper() : new ForbetHttpScraper();

export const fuksiarzScraper: FullOfferScraper =
  getTransportOverride("fuksiarz") === "browser" ? new FuksiarzBrowserScraper() : new FuksiarzHttpScraper();

export const betfanScraper: FullOfferScraper =
  getTransportOverride("betfan") === "browser" ? new BetfanBrowserScraper() : new BetfanHttpScraper();

export const fortunaScraper: FullOfferScraper =
  getTransportOverride("fortuna") === "browser" ? new FortunaBrowserScraper() : new FortunaHttpScraper();

export const superbetScraper: FullOfferScraper =
  getTransportOverride("superbet") === "browser" ? new SuperbetBrowserScraper() : new SuperbetHttpScraper();

export const lvbetScraper: FullOfferScraper =
  getTransportOverride("lvbet") === "browser" ? new LVBetBrowserScraper() : new LVBetHttpScraper();
