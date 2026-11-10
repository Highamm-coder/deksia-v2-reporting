// PROTOTYPE — short-TTL cache in front of the live vendor fetch (see ./vendors.js).
//
// The cache is Next's data cache (unstable_cache): on Vercel it is shared across function
// instances, so a second viewer inside the TTL costs no vendor call and no Google Ads operation.
// Nothing is written to Supabase. A failed fetch throws, and a throw is never cached.
import "server-only";
import { unstable_cache } from "next/cache";
import { fetchLive, missingEnv } from "./vendors";

export const LIVE_TTL_SECONDS = 3 * 60 * 60;   // 3 hours
export const LIVE_TAG = "live-vendor";

const cached = unstable_cache(
  async (source, externalId, paramsJson, start, end) =>
    fetchLive({ source, externalId, params: JSON.parse(paramsJson || "{}"), start, end }),
  ["live-vendor-v1"],
  { revalidate: LIVE_TTL_SECONDS, tags: [LIVE_TAG] },
);

// Returns { ok, data?, error?, missing?, cacheHit, waitMs }.
//   waitMs   = what THIS page view waited for the figure
//   data.ms  = what the vendor round trip took when the figure was actually fetched
export async function getLive({ source, externalId, params, start, end }) {
  const missing = missingEnv(source);
  if (missing.length) return { ok: false, missing };
  const t0 = performance.now();
  const startedAt = Date.now();
  try {
    const data = await cached(source, String(externalId), JSON.stringify(params || {}), start, end);
    // fetched before this request began = it came out of the cache
    const cacheHit = new Date(data.fetchedAt).getTime() < startedAt;
    return { ok: true, data, cacheHit, waitMs: Math.round(performance.now() - t0) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 300), waitMs: Math.round(performance.now() - t0) };
  }
}

// ---- date helpers (Eastern, like the pipeline) ----
export function etToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Last `count` months that have at least one finished day, newest first: ['2026-11','2026-10',…]
export function recentMonths(count = 16) {
  const yesterday = addDays(etToday(), -1);
  let [y, mo] = yesterday.split("-").map(Number);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(mo).padStart(2, "0")}`);
    mo -= 1; if (mo === 0) { mo = 12; y -= 1; }
  }
  return out;
}

// A month's range. An in-progress month ends yesterday (ET), the last day the pipeline has too.
export function monthRange(month) {
  const [y, mo] = month.split("-").map(Number);
  const start = `${month}-01`;
  const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  const yesterday = addDays(etToday(), -1);
  const inProgress = last > yesterday;
  return { start, end: inProgress ? yesterday : last, inProgress };
}
