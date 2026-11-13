/**
 * Parse a timestamp read from the database (or another API) into a Date.
 *
 * PostgREST returns `timestamptz` columns with an explicit offset, e.g.
 * `2026-11-06T16:02:49.048+00:00`. Such input, or input ending in `Z`, is
 * parsed as is. Appending a `Z` to it, as the old helpers did, gives an
 * Invalid Date. Offset-less input is treated as UTC: `new Date()` would read
 * it as host-local time, which is Europe/Warsaw on the dev machine.
 */
const HAS_OFFSET = /Z$|[+-]\d{2}:\d{2}$/;

export function parseDbTimestamp(ts: string): Date {
  return new Date(HAS_OFFSET.test(ts) ? ts : `${ts}Z`);
}
