/**
 * Chainable fake of the supabase-js query builder, shared by repository tests.
 *
 * Every `client.from(table)` starts a new RecordedQuery. Each chained call is
 * recorded as `[method, ...args]` and returns the same builder, so tests can
 * assert on the exact query shape (e.g. `["in", "status", ["success", "partial"]]`).
 * The builder is thenable: awaiting it resolves to
 * `{ data: null, error: null, ...respond(query) }`. `respond` runs once per
 * query, when the query is first awaited, so it sees the complete call list.
 * A `respond` that throws makes the await reject, like a thrown fetch would.
 * `respond` may return a promise, e.g. one that settles only when the
 * recorded `abortSignal` fires.
 */
export interface RecordedQuery {
  table: string;
  calls: Array<[method: string, ...args: unknown[]]>;
}

export interface FakeResponse {
  data?: unknown;
  error?: unknown;
  /** Row count, as supabase-js returns it for `{ count: "exact" }` queries. */
  count?: number | null;
}

// `lt` is not part of a plain read/write chain, but pruneStaleOddsRows()
// (full-offer-repository.ts) chains `.delete().eq().eq().lt()` after every
// clean batch save, so repository tests that reach that path need it.
// `abortSignal` bounds probeDatabase() (config/database.ts).
const CHAIN_METHODS = [
  "abortSignal",
  "select",
  "insert",
  "upsert",
  "update",
  "delete",
  "eq",
  "in",
  "not",
  "lt",
  "order",
  "range",
  "limit",
  "single",
] as const;

export function createFakeSupabase(respond: (q: RecordedQuery) => FakeResponse | Promise<FakeResponse>): {
  client: any;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];

  const client = {
    from(table: string) {
      const query: RecordedQuery = { table, calls: [] };
      queries.push(query);

      let settled: Promise<{ data: unknown; error: unknown }> | undefined;
      const builder: Record<string, unknown> = {};
      for (const method of CHAIN_METHODS) {
        builder[method] = (...args: unknown[]) => {
          query.calls.push([method, ...args]);
          return builder;
        };
      }
      builder.then = (
        onFulfilled?: (value: { data: unknown; error: unknown }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => {
        settled ??= Promise.resolve()
          .then(() => respond(query))
          .then((response) => ({ data: null, error: null, ...response }));
        return settled.then(onFulfilled, onRejected);
      };
      return builder;
    },
  };

  return { client, queries };
}
