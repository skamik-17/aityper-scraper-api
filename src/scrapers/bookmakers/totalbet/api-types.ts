/**
 * Totalbet dealer API wire types
 *
 * Shapes returned by the UUID platform under /dealer/bdata/v1/bet:
 * - GET /events?category_uuid=<uuid>&... -> TotalbetEnvelope<{ events: TotalbetListEvent[] }>
 * - GET /events/<eventUuid>              -> TotalbetEnvelope<{ event: TotalbetDetailEvent }>
 *
 * Only the fields the scraper reads are declared. Ids are UUID strings and odds
 * arrive as decimal strings (e.g. "1.65").
 */

export interface TotalbetPagination {
  total_pages: number;
  current_page: number;
  items_count: number;
  per_page: number;
}

export interface TotalbetMeta {
  code?: number;
  message?: string;
  reason?: string;
  pagination?: TotalbetPagination;
  event_types?: { type: string; count: number }[];
}

export interface TotalbetEnvelope<T> {
  data: T | null;
  state: "success" | "error";
  _meta: TotalbetMeta | null;
}

export interface TotalbetParticipant {
  name: string;
  uuid: string;
}

export interface TotalbetListOutcome {
  id: string;
  name: string;
  sort: number;
  odds: string;
  status: string;
}

export interface TotalbetListMarket {
  id: string;
  name: string;
  status: string;
  outcomes: TotalbetListOutcome[];
}

export interface TotalbetEventBase {
  uuid: string;
  name: string;
  type: string;
  status: string;
  start_at: string;
  tournament_uuid: string;
  market_count: number;
  participants: TotalbetParticipant[];
}

/** League list event: carries only the 1X2 market. */
export interface TotalbetListEvent extends TotalbetEventBase {
  markets: TotalbetListMarket[];
}

/** One cell of a component grid. */
export type TotalbetCell =
  | { type: "label"; text: string; market_id?: string }
  | { type: "empty" }
  | {
      type: "outcome";
      name: string;
      odds: string;
      uuid: string;
      market_uuid: string;
      market_status: string;
      outcome_status: string;
    };

/** One offer component (single_market, markets_in_columns, total, handicap_2col, ...). */
export interface TotalbetComponent {
  name: string;
  type: string;
  slug: string;
  grid: TotalbetCell[][];
}

/** Event detail: the full offer lives in component_lists. */
export interface TotalbetDetailEvent extends TotalbetEventBase {
  component_lists: TotalbetComponent[];
}
