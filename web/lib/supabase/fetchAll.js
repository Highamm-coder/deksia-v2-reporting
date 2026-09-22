// Fetch every row of a query, instead of however many PostgREST feels like returning.
//
// A Supabase query with no .limit() is capped server-side (1000 rows by default) and the
// truncation is SILENT — no error, no flag, just a short array. On 2026-09-22 that took whole
// months off the client page's month picker for Contingent (2306 rows), Kellogg (1190) and
// Seven Apart (1060), and every figure on those pages was being computed from the surviving
// slice. Eleven clients cross 1000 within a year at current growth, so raising the cap only
// moves the date the bug comes back.
//
// Two things make this correct rather than merely bigger:
//   • It pages until a short page proves the end, so it does not depend on what the cap is.
//   • It REQUIRES a deterministic order. Range pagination over an unordered result can repeat
//     or skip rows between pages, which would be a worse bug than the one being fixed — these
//     views end in a GROUP BY with no ORDER BY, so the order is plan-dependent unless asked for.
//
// Usage — pass a THUNK, because a PostgREST query builder can only be awaited once:
//   const monthly = await fetchAll(() =>
//     supabase.from("v_client_monthly").select("*").eq("slug", slug)
//       .order("month_start").order("source").order("metric_name").order("account_ext_id"));

const PAGE = 1000;
const MAX_PAGES = 40;          // 40k rows; a client page needing more has a different problem

export async function fetchAll(build, { page = PAGE, maxPages = MAX_PAGES } = {}) {
  const out = [];
  for (let i = 0; i < maxPages; i++) {
    const from = i * page;
    const { data, error } = await build().range(from, from + page - 1);
    if (error) throw new Error(`fetchAll: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < page) break;                       // a short page is the end
    if (i === maxPages - 1) {
      // Never truncate silently — that is the whole point of this helper.
      console.warn(`fetchAll: stopped at ${out.length} rows after ${maxPages} pages; result may be incomplete`);
    }
  }
  return out;
}
