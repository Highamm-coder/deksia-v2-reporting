// PROTOTYPE — live vs stored, side by side. Admin only. Read-only: nothing here writes to
// fact_daily or any pipeline table. It exists so Matt can judge speed and accuracy of
// fetch-on-demand before deciding whether it can replace the nightly stored pipeline.
import { Suspense } from "react";
import { getSupabaseServer } from "../../../lib/supabase/server";
import AppShell from "../../_components/AppShell";
import Spinner from "../../_components/Spinner";
import { fmtVal, fmtMonth, SRC_LABEL, METRIC_LABEL } from "../../../lib/format";
import { getLive, recentMonths, monthRange, LIVE_TTL_SECONDS } from "../../../lib/live";
import { LIVE_SOURCES, REQUIRED_ENV } from "../../../lib/live/vendors";
import { refreshLive } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_CLIENT = "Veritas";
const digits = (s) => String(s ?? "").replace(/\D/g, "");
const sameAccount = (source, a, b) =>
  String(a) === String(b) || ((source === "google_ads" || source === "meta") && digits(a) !== "" && digits(a) === digits(b));
const label = (name) => METRIC_LABEL[name] || name.replace(/_/g, " ");
const clock = (iso) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) + " ET";

function Diff({ live, stored, unit }) {
  if (live == null || stored == null) return <span className="muted">—</span>;
  const d = live - stored;
  const same = Math.abs(d) < 0.005 || Math.abs(d) <= Math.abs(stored) * 1e-6;
  if (same) return <span style={{ color: "var(--on)" }}>match</span>;
  const pct = stored !== 0 ? ` (${d > 0 ? "+" : "−"}${Math.abs((d / stored) * 100).toFixed(1)}%)` : "";
  return <span style={{ color: "var(--off)" }}>{d > 0 ? "+" : "−"}{fmtVal(Math.abs(d), unit)}{pct}</span>;
}

function MetricTable({ liveMetrics, storedRows }) {
  const storedBy = Object.fromEntries(storedRows.map((r) => [r.metric_name, r]));
  const liveNames = Object.keys(liveMetrics);
  const storedOnly = storedRows.filter((r) => !(r.metric_name in liveMetrics));
  return (
    <div className="tablewrap">
      <table>
        <thead><tr><th>Metric</th><th style={{ textAlign: "right" }}>Live</th><th style={{ textAlign: "right" }}>Stored</th><th style={{ textAlign: "right" }}>Difference</th><th>How the stored figure is built</th></tr></thead>
        <tbody>
          {liveNames.map((name) => {
            const lv = liveMetrics[name], st = storedBy[name];
            const unit = lv.unit || st?.unit;
            const how = !st
              ? (lv.kind === "unique" ? "Not stored: cannot be summed from days" : "No stored row this month")
              : st.agg === "avg" ? `Average of ${st.day_count} daily values` : `Sum of daily rows (${st.day_count} days)`;
            return (
              <tr key={name}>
                <td>{label(name)}</td>
                <td style={{ textAlign: "right" }}>{fmtVal(lv.value, unit)}</td>
                <td style={{ textAlign: "right" }}>{st ? fmtVal(st.value, unit) : <span className="muted">—</span>}</td>
                <td style={{ textAlign: "right" }}><Diff live={lv.value} stored={st ? Number(st.value) : null} unit={unit} /></td>
                <td className="muted">{how}</td>
              </tr>
            );
          })}
          {!liveNames.length && <tr><td colSpan={5} className="muted">The platform returned no row for this range.</td></tr>}
        </tbody>
      </table>
      {storedOnly.length > 0 && (
        <details style={{ margin: "8px 0 0", fontSize: 13 }}>
          <summary className="muted">{storedOnly.length} stored metric{storedOnly.length === 1 ? "" : "s"} this prototype does not ask for live</summary>
          <p className="muted" style={{ margin: "6px 0 0", whiteSpace: "normal" }}>
            {storedOnly.map((r) => `${label(r.metric_name)} ${fmtVal(r.value, r.unit)}`).join(" · ")}
          </p>
        </details>
      )}
    </div>
  );
}

function Breakdown({ data }) {
  if (!data.breakdown?.length) return null;
  const cols = [...new Set(data.breakdown.flatMap((b) => Object.keys(b.metrics)))];
  return (
    <details style={{ margin: "10px 0 0", fontSize: 13 }}>
      <summary className="muted">{data.breakdown.length} {data.breakdownLabel.toLowerCase()} row{data.breakdown.length === 1 ? "" : "s"} (live)</summary>
      <div className="tablewrap" style={{ marginTop: 6 }}>
        <table>
          <thead><tr><th>{data.breakdownLabel}</th>{cols.map((c) => <th key={c} style={{ textAlign: "right" }}>{label(c)}</th>)}</tr></thead>
          <tbody>
            {data.breakdown.map((b, i) => (
              <tr key={i}><td>{b.name || "(unnamed)"}</td>
                {cols.map((c) => <td key={c} style={{ textAlign: "right" }}>{b.metrics[c] ? fmtVal(b.metrics[c].value, b.metrics[c].unit) : "—"}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

async function SourceResult({ promise, storedRows }) {
  const res = await promise;
  if (res.missing) {
    return (
      <p style={{ fontSize: 13, whiteSpace: "normal" }}>
        <span className="pill stale">not configured</span>{" "}
        Live fetch needs these environment variables, which are not set here: <code>{res.missing.join(", ")}</code>.
        Matt sets them in Vercel (Project → Settings → Environment Variables) or in <code>web/.env.local</code>.
      </p>
    );
  }
  if (!res.ok) {
    return <p style={{ fontSize: 13, color: "var(--off)", whiteSpace: "normal" }}>Live fetch failed after {res.waitMs} ms: {res.error}</p>;
  }
  const d = res.data;
  return (
    <>
      <p className="muted" style={{ margin: "0 0 8px", fontSize: 13, whiteSpace: "normal" }}>
        {res.cacheHit
          ? <><strong style={{ color: "var(--txt)" }}>Cached</strong>: this view waited {res.waitMs} ms and made no vendor call. Fetched at {clock(d.fetchedAt)}, when it took {d.ms.toLocaleString()} ms.</>
          : <><strong style={{ color: "var(--txt)" }}>Fetched live in {d.ms.toLocaleString()} ms</strong> ({d.calls} API call{d.calls === 1 ? "" : "s"}{d.quotaOps ? `, ${d.quotaOps} Google Ads operation${d.quotaOps === 1 ? "" : "s"}` : ""}).</>}
        {" "}{d.note}
      </p>
      <MetricTable liveMetrics={d.metrics} storedRows={storedRows} />
      <Breakdown data={d} />
    </>
  );
}

async function Totals({ promises }) {
  const all = await Promise.all(promises);
  const ok = all.filter((r) => r.ok);
  if (!ok.length) return null;
  const fresh = ok.filter((r) => !r.cacheHit);
  const slowest = Math.max(...ok.map((r) => r.waitMs));
  const ops = fresh.reduce((n, r) => n + (r.data.quotaOps || 0), 0);
  return (
    <p style={{ fontSize: 13, margin: "0 0 4px", whiteSpace: "normal" }}>
      <strong>This view:</strong> sources are fetched in parallel, so the page waited {slowest.toLocaleString()} ms for the slowest one.{" "}
      {fresh.length} of {ok.length} fetched live, {ok.length - fresh.length} from cache.{" "}
      Google Ads operations spent: {ops} of 2,880 per day.
    </p>
  );
}

export default async function LivePage({ searchParams }) {
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) {
    return (
      <AppShell>
        <h1 style={{ fontSize: 22 }}>Live vs stored</h1>
        <p className="muted">You&apos;re not an admin. Ask an existing admin to add you.</p>
      </AppShell>
    );
  }

  const months = recentMonths(16);
  const defaultMonth = months.find((mm) => !monthRange(mm).inProgress) || months[0];
  const month = typeof searchParams?.month === "string" && months.includes(searchParams.month) ? searchParams.month : defaultMonth;
  const { start, end, inProgress } = monthRange(month);

  const { data: clients } = await supabase.from("clients").select("slug, name").order("name");
  const want = typeof searchParams?.client === "string" ? searchParams.client : DEFAULT_CLIENT;
  const client = (clients || []).find((c) => c.slug === want) || (clients || []).find((c) => c.slug === DEFAULT_CLIENT) || (clients || [])[0];

  let mappings = [], stored = [], storedMs = 0, storedErr = null;
  if (client) {
    const t0 = performance.now();
    const [m1, s1] = await Promise.all([
      supabase.from("client_sources").select("id, source, external_id, active, params, clients!inner(slug)")
        .eq("clients.slug", client.slug).eq("active", true).in("source", LIVE_SOURCES).order("source").order("id"),
      supabase.from("v_client_monthly").select("source, account_ext_id, metric_name, unit, agg, value, day_count")
        .eq("slug", client.slug).eq("month_start", start).order("source").order("metric_name").order("account_ext_id").limit(5000),
    ]);
    storedMs = Math.round(performance.now() - t0);
    mappings = m1.data || [];
    stored = s1.data || [];
    storedErr = m1.error?.message || s1.error?.message || null;
  }

  // Start every live fetch now, in parallel; each card streams in as its source answers.
  const order = (s) => LIVE_SOURCES.indexOf(s);
  const cards = mappings.sort((a, b) => order(a.source) - order(b.source)).map((mp) => ({
    mp,
    promise: getLive({ source: mp.source, externalId: mp.external_id, params: mp.params, start, end }),
    storedRows: stored.filter((r) => r.source === mp.source && sameAccount(mp.source, r.account_ext_id, mp.external_id)),
  }));

  return (
    <AppShell>
      <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>Live vs stored <span className="pill stale">prototype</span></h1>
      <p className="muted" style={{ margin: "0 0 12px", fontSize: 13, maxWidth: 820 }}>
        The left number is asked from the platform right now for the whole month (kept for {LIVE_TTL_SECONDS / 3600} hours, then asked again).
        The right number is what the nightly pipeline stored and the client page shows. This page reads only; it stores nothing.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", margin: "0 0 14px" }}>
        <form method="get" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", margin: 0 }}>
          <label style={{ margin: 0 }}>Client
            <select name="client" defaultValue={client?.slug} style={{ width: "auto" }}>
              {(clients || []).map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </label>
          <label style={{ margin: 0 }}>Month
            <select name="month" defaultValue={month} style={{ width: "auto" }}>
              {months.map((mm) => <option key={mm} value={mm}>{fmtMonth(`${mm}-01`)}{monthRange(mm).inProgress ? " (in progress)" : ""}</option>)}
            </select>
          </label>
          <button type="submit" style={{ margin: 0 }}>Compare</button>
        </form>
        <form action={refreshLive} style={{ margin: 0 }}>
          <input type="hidden" name="client" value={client?.slug || ""} />
          <input type="hidden" name="month" value={month} />
          <button type="submit" style={{ margin: 0 }}>Clear cache and fetch again</button>
        </form>
      </div>

      <p style={{ fontSize: 13, margin: "0 0 4px", whiteSpace: "normal" }}>
        <strong>{client?.name}</strong>, {start} to {end}{inProgress ? " (month in progress: live stops at yesterday, as the pipeline does)" : ""}.{" "}
        Stored figures and mappings read from the database in {storedMs.toLocaleString()} ms.
      </p>
      {storedErr && <p style={{ fontSize: 13, color: "var(--off)" }}>Stored read failed: {storedErr}</p>}
      <Suspense fallback={<p className="muted" style={{ fontSize: 13, margin: "0 0 4px" }}><Spinner label="Fetching live" /> Asking the platforms…</p>}>
        <Totals promises={cards.map((c) => c.promise)} />
      </Suspense>

      {!cards.length && <p className="muted">This client has no active Google Ads, GA4, Search Console, CallRail or Meta mapping.</p>}

      {cards.map(({ mp, promise, storedRows }) => (
        <section key={mp.id}>
          <h2 style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            {SRC_LABEL[mp.source] || mp.source}
            <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
              {mp.params?.label || mp.params?.account || ""} {mp.external_id} · mapping #{mp.id}
            </span>
          </h2>
          <Suspense fallback={<p className="muted" style={{ fontSize: 13 }}><Spinner label="Fetching live" /> Asking {SRC_LABEL[mp.source] || mp.source}…</p>}>
            <SourceResult promise={promise} storedRows={storedRows} />
          </Suspense>
        </section>
      ))}

      <section>
        <h2>What this needs to run</h2>
        <p className="muted" style={{ fontSize: 13, whiteSpace: "normal", maxWidth: 820 }}>
          The same secrets the nightly run uses, set as environment variables where the console runs. Names only:{" "}
          <code>{[...new Set(Object.values(REQUIRED_ENV).flat())].join(", ")}</code>.
        </p>
      </section>
    </AppShell>
  );
}
