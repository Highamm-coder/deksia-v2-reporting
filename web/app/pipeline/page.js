import { getSupabaseServer } from "../../lib/supabase/server";
import AppShell from "../_components/AppShell";
import { runConnectionTest, enqueueGadsBackfill } from "./actions";
import Matrix from "./Matrix";

export const dynamic = "force-dynamic";
const num = (v, d = 0) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));
const when = (ts) => (ts ? new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

const PROVIDER_LABEL = {
  meta: "Meta access token", google_oauth: "Google OAuth (GA4)",
  callrail: "CallRail API key", ingest_token: "Ingest token (Ads Scripts)",
};

function credPill(c) {
  if (c.status === "expired") return ["off_track", "expired"];
  if (c.status !== "ok") return ["pending", c.status];
  if (!c.expires_at) return ["fresh", "no expiry"];
  const days = Math.round((new Date(c.expires_at) - Date.now()) / 864e5);
  if (days <= 0) return ["off_track", "expired"];
  if (days <= 5) return ["off_track", `${days}d left`];
  if (days <= 14) return ["stale", `${days}d left`];
  return ["fresh", `${days}d left`];
}

const TEST_MSG = {
  started: ["Connection test started — results land here in ~30 seconds. Refresh to see them.", "var(--on)"],
  failed: ["Couldn't start the test — GitHub rejected the request (check the dispatch token).", "var(--off)"],
  notoken: ["No GITHUB_DISPATCH_TOKEN set in Vercel — add it to enable one-click testing.", "var(--risk)"],
  forbidden: ["Admins only.", "var(--off)"],
};

// Two tabs, two questions. Access: can we read each account? Freshness: did data land?
const TABS = [["access", "Access"], ["freshness", "Freshness"]];

function Tabs({ current, counts }) {
  return (
    <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)", margin: "14px 0 4px" }}>
      {TABS.map(([key, label]) => {
        const on = key === current;
        return (
          <a key={key} href={`/pipeline?tab=${key}`} style={{
            padding: "8px 14px", fontSize: 13.5, fontWeight: 600, textDecoration: "none",
            color: on ? "var(--txt)" : "var(--muted)",
            borderBottom: on ? "2px solid var(--txt)" : "2px solid transparent", marginBottom: -1,
          }}>
            {label}
            {counts?.[key] != null && (
              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 999,
                background: counts[key] > 0 ? "rgba(217,48,37,.10)" : "var(--panel2)",
                color: counts[key] > 0 ? "var(--off)" : "var(--muted)" }}>
                {counts[key] > 0 ? `${counts[key]} issue${counts[key] === 1 ? "" : "s"}` : "all clear"}
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}

export default async function Pipeline({ searchParams }) {
  const tab = searchParams?.tab === "freshness" ? "freshness" : "access";
  const supabase = getSupabaseServer();
  const [{ data: pipeline }, { data: creds }, { data: checks }, { data: probes }, { data: isAdmin }, { data: bf }, { data: clients }, { data: sources }] = await Promise.all([
    supabase.from("v_pipeline_health").select("*").order("slug").order("source"),
    supabase.from("connector_status").select("*").order("provider"),
    supabase.from("integrity_checks").select("*").order("checked_at", { ascending: false }).limit(1),
    supabase.from("connection_probes").select("*").order("source").order("client_slug"),
    supabase.rpc("is_admin"),
    supabase.from("v_gads_backfill_progress").select("*").order("slug"),
    supabase.from("clients").select("id, slug, name, status").neq("status", "archived").order("name"),
    supabase.from("client_sources").select("client_id, source, external_id, active"),
  ]);

  let testMsg = TEST_MSG[searchParams?.test];
  if (searchParams?.test === "failed" && searchParams?.why) {
    const why = String(searchParams.why);
    const hint = /401|Bad credentials/i.test(why)
      ? " → the token is wrong or expired (re-copy it; no spaces/newlines)."
      : /403|not accessible|Resource not accessible/i.test(why)
        ? " → the token lacks Actions: Read and write on this repo (fine-grained tokens also need the repo explicitly selected)."
        : /404/.test(why)
          ? " → token can't see this repo/workflow (check repo access on the token)."
          : "";
    testMsg = [`GitHub said: ${why}${hint}`, "var(--off)"];
  }

  const probeRows = probes || [];
  const probedAt = probeRows.length ? probeRows.map((p) => p.probed_at).sort().at(-1) : null;
  const unreachable = probeRows.filter((p) => p.active && !p.reachable && p.source !== "google_ads");
  const fresh = (pipeline || []).filter((r) => r.sync_status === "fresh").length;
  const notFresh = (pipeline || []).filter((r) => r.sync_status !== "fresh" && r.sync_status !== "idle").length;
  const chk = checks?.[0] || null;
  const chkPill = chk ? (chk.status === "ok" ? "fresh" : chk.status === "attention" ? "stale" : "off_track") : "pending";
  const credIssues = (creds || []).filter((c) => credPill(c)[0] !== "fresh").length;

  return (
    <AppShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 2px" }}>Pipeline health</h1>
        {isAdmin && (
          <form action={runConnectionTest} style={{ margin: 0 }}>
            <button type="submit" style={{ margin: 0 }}>⚡ Test connections now</button>
          </form>
        )}
      </div>
      {testMsg && <div style={{ margin: "6px 0 0", fontSize: 13, color: testMsg[1] }}>{testMsg[0]}</div>}

      <Tabs current={tab} counts={{ access: unreachable.length + credIssues, freshness: notFresh }} />

      {tab === "access" ? (
        <>
          <h2>Which accounts we can read {probedAt && <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· tested {when(probedAt)}</span>}</h2>
          <Matrix mode="access" clients={clients} sources={sources} probes={probeRows} />

          {unreachable.length > 0 && (
            <>
              <h2>Refused by the provider</h2>
              <table>
                <thead><tr><th>Client</th><th>Platform</th><th>Account</th><th style={{ whiteSpace: "normal" }}>Provider says</th></tr></thead>
                <tbody>
                  {unreachable.map((p) => (
                    <tr key={`${p.client_slug}|${p.source}|${p.external_id}`}>
                      <td>{p.client_slug}</td>
                      <td className="muted">{p.source}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{p.external_id}</td>
                      <td style={{ whiteSpace: "normal", fontSize: 12 }}>{p.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h2>Credentials</h2>
          <table>
            <thead><tr><th>Credential</th><th>Status</th><th>Expires</th><th style={{ whiteSpace: "normal" }}>Detail</th><th>Checked</th></tr></thead>
            <tbody>
              {(creds || []).map((c) => {
                const [cls, txt] = credPill(c);
                return (
                  <tr key={c.provider}>
                    <td>{PROVIDER_LABEL[c.provider] || c.provider}</td>
                    <td><span className={`pill ${cls}`}>{txt}</span></td>
                    <td>{c.expires_at ? new Date(c.expires_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}</td>
                    <td className="muted" style={{ whiteSpace: "normal", fontSize: 12 }}>{c.detail}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{when(c.checked_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted" style={{ margin: "4px 0 18px", fontSize: 12 }}>
            Every mapped account is probed nightly with the live credential. Meta expiry is read from Facebook&apos;s own
            token introspection on every run — never hand-maintained. Use the button above after rotating a credential.
          </p>
        </>
      ) : (
        <>
          <h2>Did data land — {fresh}/{pipeline?.length ?? 0} fresh</h2>
          <Matrix mode="freshness" clients={clients} sources={sources} health={pipeline} />

          <h2>Data integrity</h2>
          <div className="card" style={{ maxWidth: "none", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            {chk ? (
              <>
                <span className={`pill ${chkPill}`} style={{ fontSize: 12 }}>
                  {chk.status === "ok" ? "✓ verified" : chk.status === "attention" ? "⚠ attention" : "✕ issues"}
                </span>
                <span style={{ fontSize: 13 }}>
                  {chk.status === "ok"
                    ? `No gaps in the last ${chk.summary?.window_days ?? 14} days — every source-day present or verified with the platform.`
                    : chk.summary?.google_ads_gaps?.length
                      ? `Google Ads missing: ${chk.summary.google_ads_gaps.join(", ")} — run the MCC backfill script for those dates.`
                      : `${chk.summary?.sweep_failures ?? "?"} re-pull failure(s) during the gap sweep — check the run log.`}
                </span>
                {chk.gaps_found > 0 && chk.rows_healed > 0 && (
                  <span className="muted" style={{ fontSize: 12 }}>self-healed {chk.gaps_found} gap-day(s), {chk.rows_healed.toLocaleString()} rows re-pulled</span>
                )}
                <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>checked {when(chk.checked_at)} · runs nightly</span>
              </>
            ) : (
              <span className="muted" style={{ fontSize: 13 }}>First integrity check runs with tonight&apos;s sync.</span>
            )}
          </div>

          <h2>Google Ads backfill queue</h2>
          <div className="card" style={{ maxWidth: "none" }}>
            <p className="muted" style={{ margin: "0 0 8px", fontSize: 12.5 }}>
              Queue a date range once; each account&apos;s Ads Script claims up to 20 days per hourly run
              and drains it unattended. Idempotent — re-queuing a day just rewrites it.
              {searchParams?.bf && !["forbidden","baddate","failed"].includes(String(searchParams.bf))
                && <strong style={{ color: "var(--on)" }}> Queued {searchParams.bf} account-days.</strong>}
              {searchParams?.bf === "failed" && <strong style={{ color: "var(--off)" }}> Couldn&apos;t queue.</strong>}
            </p>
            {isAdmin && (
              <form action={enqueueGadsBackfill} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", margin: 0 }}>
                <label style={{ margin: 0 }}>From<input name="start" type="date" defaultValue="2026-01-01" style={{ width: "auto" }} /></label>
                <label style={{ margin: 0 }}>To<input name="end" type="date" style={{ width: "auto" }} /></label>
                <button type="submit" style={{ margin: 0 }}>Queue backfill</button>
              </form>
            )}
            {(bf || []).some((r) => r.pending > 0 || r.in_flight > 0) ? (
              <table style={{ marginTop: 10 }}>
                <thead><tr><th>Client</th><th>Account</th><th className="num">Done</th><th className="num">Pending</th>
                  <th className="num">In flight</th><th className="num">Errors</th><th>Oldest outstanding</th><th>Last write</th></tr></thead>
                <tbody>
                  {(bf || []).filter((r) => r.pending > 0 || r.in_flight > 0 || r.errored > 0).map((r) => (
                    <tr key={r.cid}>
                      <td>{r.slug || "—"}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{r.account_label}</td>
                      <td className="num">{r.done}</td>
                      <td className="num">{r.pending}</td>
                      <td className="num">{r.in_flight}</td>
                      <td className="num" style={r.errored > 0 ? { color: "var(--off)" } : undefined}>{r.errored}</td>
                      <td style={{ fontSize: 12 }}>{r.oldest_outstanding || "—"}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{when(r.last_write)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (bf || []).length ? (
              <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>Queue empty — every queued day has been written.</p>
            ) : null}
          </div>

          <h2>Detail by account</h2>
          <table>
            <thead><tr><th>Client</th><th>Platform</th><th>Status</th><th>Last data</th><th className="num">Rows 30d</th><th className="num">Metrics</th></tr></thead>
            <tbody>
              {(pipeline || []).map((r, i) => (
                <tr key={i}>
                  <td><a href={`/clients/${encodeURIComponent(r.slug)}`}>{r.slug}</a></td>
                  <td className="muted">{r.source}</td>
                  <td><span className={`pill ${r.sync_status}`}>{r.sync_status?.replace("_", " ")}</span></td>
                  <td>{r.last_metric_date || "—"}</td>
                  <td className="num">{num(r.rows_30d)}</td>
                  <td className="num">{num(r.metric_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </AppShell>
  );
}
