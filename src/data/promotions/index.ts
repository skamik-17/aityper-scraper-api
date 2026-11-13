import type { Promotion } from "../../types/promotions.js";
import { stsPromotions } from "./sts.js";
import { fortunaPromotions } from "./fortuna.js";
import { betclicPromotions } from "./betclic.js";
import { superbetPromotions } from "./superbet.js";
import { lvbetPromotions } from "./lvbet.js";
import { fuksiarzPromotions } from "./fuksiarz.js";
import { betfanPromotions } from "./betfan.js";
import { totalbetPromotions } from "./totalbet.js";
import { forbetPromotions } from "./forbet.js";
import { etotoPromotions } from "./etoto.js";
import { bettersPromotions } from "./betters.js";
import { lebullPromotions } from "./lebull.js";
import { betcrisPromotions } from "./betcris.js";
import { pzbukPromotions } from "./pzbuk.js";

// Concatenated in ALL_POLISH_BOOKMAKERS order.
export const PROMOTION_CATALOG: Promotion[] = [
  ...stsPromotions,
  ...fortunaPromotions,
  ...betclicPromotions,
  ...superbetPromotions,
  ...lvbetPromotions,
  ...fuksiarzPromotions,
  ...betfanPromotions,
  ...totalbetPromotions,
  ...forbetPromotions,
  ...etotoPromotions,
  ...bettersPromotions,
  ...lebullPromotions,
  ...betcrisPromotions,
  ...pzbukPromotions,
];
