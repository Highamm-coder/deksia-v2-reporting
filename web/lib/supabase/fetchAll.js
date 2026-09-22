// Fetch every row of a query, instead of however many PostgREST feels like returning.
//
// A Supabase query with no .limit() is capped server-side (1000 rows) and the truncation is
// SILENT — no error, no flag, just a short array. On 2026-09-22 that took whole months off the
// client page's month picker for Contingent (2306 rows), Kellogg (1190) and Seven Apart (1060),
// and every figure on those pages was being computed from the surviving slice. Eleven clients
// cross 1000 within a year at current growth, so raising the cap only moves the date it returns.
//
// Three things make this correct rather than merely bigger:
//   • It pages until a short page proves the end, so it does not depend on what the cap is.
//   • It REQUIRES a deterministic order. Range pagination over an unordered result can repeat
//     or skip rows between pages, which would be a worse bug than the one being fixed — these
//     views end in a GROUP BY with no ORDER BY, so the order is plan-dependent unless asked for.
//   • After the first page it fetches WAVE pages at once. Each page is a separate round trip
//     that re-runs the whole query, so paging one at a time made the biggest queries the slowest
//     part of the page load: 2306 rows meant three sequential trips. A wave of 2 finishes the
//     same client in two, and costs no extra query while clients stay under 3000 rows.
//
// Usage — pass a THUNK, because a PostgREST query builder can only be awaited once:
//   const monthly = await fetchAll(() =>
//     supabase.from("v_client_monthly").select("*").eq("slug", slug)
//       .order("month_start").order("source").order("metric_name").order("account_ext_id"));

const PAGE = 1000;
const WAVE = 2;                // pages fetched in parallel once we know there is more than one
const MAX_PAGES = 40;          // 40k rows; a client page needing more has a different problem

async function getPage(build, index, page) {
  const from = index * page;
  const { data, error } = await build().range(from, from + page - 1);
  if (error) throw new Error(`fetchAll: ${error.message}`);
  return data || [];
}

export async function fetchAll(build, { page = PAGE, wave = WAVE, maxPages = MAX_PAGES } = {}) {
  const out = await getPage(build, 0, page);
  if (out.length < page) return out;           // the common case: one trip, no wave

  let next = 1;
  while (next < maxPages) {
    const size = Math.min(wave, maxPages - next);
    const pages = await Promise.all(
      Array.from({ length: size }, (_, k) => getPage(build, next + k, page))
    );
    for (const rows of pages) {
      out.push(...rows);
      // A short page is the end. Anything later in this wave was already past it, so it is
      // empty by definition — dropping it is what keeps the result in page order.
      if (rows.length < page) return out;
    }
    next += size;
  }
  // Never truncate silently — that is the whole point of this helper.
  console.warn(`fetchAll: stopped at ${out.length} rows after ${maxPages} pages; result may be incomplete`);
  return out;
}
