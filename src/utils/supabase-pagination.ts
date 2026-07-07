/**
 * PostgREST caps a single request at ~1000 rows. Any per-match query against
 * the odds views can exceed that (a well-normalized match yields 1000+ rows),
 * which silently truncates results — whole market categories vanished from
 * the API this way. This helper pages through a query until a short page
 * signals the end.
 *
 * The callback receives (from, to) and must apply `.range(from, to)` on an
 * otherwise fully-built query.
 */
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<{ data: T[]; error: unknown | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) return { data: rows, error };
    if (data && data.length > 0) rows.push(...data);
    if (!data || data.length < pageSize) break;
  }
  return { data: rows, error: null };
}
