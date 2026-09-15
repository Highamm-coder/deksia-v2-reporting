import { getSupabaseServer } from "../../lib/supabase/server";
import AppShell from "../_components/AppShell";
import { runConnectionTest, createBackfill, setBackfillStatus, runBackfillNow } from "./actions";
import Matrix from "./Matrix";

export const dynamic = "force-dynamic";
const num = (v, d = 0) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));
const when = (ts) => (ts ? new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

const PROVIDER_LABEL = { meta: "Meta token", google_oauth: "Google OAuth", callrail: "CallRail key" };

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

const PLATFORM_NAME = { meta: "Meta Ads", google_ads: "Google Ads", ga4: "GA4", callrail: "CallRail", pages: "Facebook Pages", search_console: "Search Console", youtube: "YouTube" };
const BF_MSG = {
  queued: ["Queued — the runner picks it up within two hours.", "var(--on)"],
  updated: ["Updated.", "var(--on)"],
  started: ["Runner started — results appear here as chunks finish.", "var(--on)"],
  notoken: ["No GITHUB_DISPATCH_TOKEN in Vercel — the runner still fires on its own every two hours.", "var(--risk)"],
  baddate: ["Need both dates as YYYY-MM-DD.", "var(--off)"],
  forbidden: ["Admins only.", "var(--off)"],
  failed: ["Couldn't do that.", "var(--off)"],
};

// Two tabs, two questions. Access: can we read each account? Freshness: did data land?

export default async function Pipeline({ searchParams }) {
  const supabase = getSupabaseServer();
  const [{ data: pipeline }, { data: creds }, { data: checks }, { data: probes }, { data: isAdmin }, { data: jobs }, { data: clients }, { data: sources }, { data: sourcesReg }, { data: rollup }] = await Promise.all([
    supabase.from("v_pipeline_health").select("*").order("slug").order("source"),
    supabase.from("connector_status").select("*").order("provider"),
    supabase.from("integrity_checks").select("*").order("checked_at", { ascending: false }).limit(1),
    supabase.from("connection_probes").select("*").order("source").order("client_slug"),
    supabase.rpc("is_admin"),
    supabase.from("v_backfill_jobs").select("*").order("created_at", { ascending: false }).limit(20),
    supabase.from("clients").select("id, slug, name, status").neq("status", "archived").order("name"),
    supabase.from("client_sources").select("id, client_id, source, external_id, active, params"),
    supabase.from("v_sources").select("source, label, active").neq("source", "manual"),
    supabase.from("rollup_status").select("refreshed_at").eq("id", 1).maybeSingle(),
  ]);
  const registry = (sourcesReg || []).filter((r) => r.active).map((r) => [r.source, r.label]);

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
  // a refused probe only counts if its account is still mapped (old IDs linger in the probe table)
  const isMapped = (p) => (sources || []).some((s) => s.active && s.source === p.source && String(s.external_id).replace(/\D/g, "") === String(p.external_id).replace(/\D/g, ""));
  const unreachable = probeRows.filter((p) => p.active && !p.reachable && isMapped(p));
  const fresh = (pipeline || []).filter((r) => r.sync_status === "fresh").length;
  const notFresh = (pipeline || []).filter((r) => r.sync_status !== "fresh" && r.sync_status !== "idle").length;
  const chk = checks?.[0] || null;
  const chkPill = chk ? (chk.status === "ok" ? "fresh" : chk.status === "attention" ? "stale" : "off_track") : "pending";
  // only expired / expiring credentials are issues; "unknown" (no read this run) is not
  const credIssues = (creds || []).filter((c) => ["off_track", "stale"].includes(credPill(c)[0])).length;

  const accessIssues = unreachable.length;
  const credPills = (creds || []).filter((c) => c.provider !== "ingest_token").map((c) => [c.provider, ...credPill(c)]);
  const mappingFor = (p) => (sources || []).find((s) => s.source === p.source && String(s.external_id).replace(/\D/g, "") === String(p.external_id).replace(/\D/g, ""));
  const clientFor = (slug) => (clients || []).find((c) => c.slug === slug);

  return (
    <AppShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 2px" }}>Data health</h1>
        {isAdmin && (
          <form action={runConnectionTest} style={{ margin: 0 }}>
            <button type="submit" style={{ margin: 0 }}>⚡ Test connections now</button>
          </form>
        )}
      </div>
      {testMsg && <div style={{ margin: "6px 0 0", fontSize: 13, color: testMsg[1] }}>{testMsg[0]}</div>}

      {/* the 5-second answer: everything that decides "is it fine", one line, no scrolling */}
      <div className="card" style={{ maxWidth: "none", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "12px 0 4px" }}>
        <span className={`pill ${accessIssues ? "off_track" : "fresh"}`}>{accessIssues ? `${accessIssues} access issue${accessIssues === 1 ? "" : "s"}` : "access: all clear"}</span>
        <span className={`pill ${notFresh ? "stale" : "fresh"}`}>{notFresh ? `${notFresh} stale` : `freshness: ${fresh}/${pipeline?.length ?? 0} fresh`}</span>
        {credPills.map(([prov, cls, txt]) => <span key={prov} className={`pill ${cls}`} title={PROVIDER_LABEL[prov] || prov}>{(PROVIDER_LABEL[prov] || prov).split(" ")[0]} · {txt}</span>)}
        <span className={`pill ${chkPill}`}>{chk ? (chk.status === "ok" ? "integrity ✓" : chk.status === "attention" ? "integrity ⚠" : "integrity ✕") : "integrity pending"}</span>
        {(jobs || []).some((j) => j.status === "active" && (j.deferred > 0 || j.errored > 0)) && <span className="pill stale">backfill waiting</span>}
        <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
          probed {when(probedAt)} · rollup {when(rollup?.refreshed_at)} (fill lags ring ≤1h after a fix)
        </span>
      </div>

      <Matrix clients={clients} sources={sources} probes={probeRows} health={pipeline} platforms={registry} />

      {unreachable.length > 0 && (
        <>
          <h2>Refused by the provider</h2>
          <table>
            <thead><tr><th>Client</th><th>Platform</th><th>Account</th><th style={{ whiteSpace: "normal" }}>Provider says</th><th></th></tr></thead>
            <tbody>
              {unreachable.map((p) => { const m = mappingFor(p); const c = clientFor(p.client_slug); return (
                <tr key={`${p.client_slug}|${p.source}|${p.external_id}`}>
                  <td>{c?.name || p.client_slug}</td>
                  <td className="muted">{PLATFORM_NAME[p.source] || p.source}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{m?.params?.label ? `${m.params.label} · ` : ""}{p.external_id}</td>
                  <td style={{ whiteSpace: "normal", fontSize: 12 }}>{p.detail}</td>
                  <td>{m && <a href={`/connections?client=${encodeURIComponent(p.client_slug)}&mapping=${m.id}#mapping-${m.id}`} style={{ fontSize: 12, fontWeight: 600 }}>Fix →</a>}</td>
                </tr>); })}
            </tbody>
          </table>
        </>
      )}

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
                      ? `Google Ads days missing: ${chk.summary.google_ads_gaps.join(", ")} — queue a Google Ads backfill below (or wait: the sentinel retries once the quota is back).`
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

          <h2 id="backfills">Backfills</h2>
          <div className="card" style={{ maxWidth: "none" }}>
            <p className="muted" style={{ margin: "0 0 8px", fontSize: 12.5 }}>
              Queue a date range once and the runner works through it a month at a time, every two hours, unattended.
              Re-pulling a day overwrites it — never double-counts. Google Ads is held to three months a day by Google&apos;s
              quota; when a platform says &quot;retry later&quot; the job pauses itself and resumes on its own.
              {BF_MSG[searchParams?.bf] && <strong style={{ color: BF_MSG[searchParams.bf][1] }}> {BF_MSG[searchParams.bf][0]}{searchParams?.why ? ` — ${searchParams.why}` : ""}</strong>}
            </p>
            {isAdmin && (
              <form action={createBackfill} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", margin: 0 }}>
                <label style={{ margin: 0 }}>Platform
                  <select name="source" defaultValue={searchParams?.source || ""} style={{ width: "auto" }}>
                    <option value="">all</option>
                    {registry.map(([src, label]) => <option key={src} value={src}>{label}</option>)}
                  </select>
                </label>
                <label style={{ margin: 0 }}>Client
                  <select name="client_slug" defaultValue={searchParams?.client || ""} style={{ width: "auto", maxWidth: 220 }}>
                    <option value="">all clients</option>
                    {(clients || []).map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
                  </select>
                </label>
                <label style={{ margin: 0 }}>From<input name="start" type="date" defaultValue={searchParams?.start || `${new Date().getUTCFullYear()}-01-01`} style={{ width: "auto" }} /></label>
                <label style={{ margin: 0 }}>To<input name="end" type="date" defaultValue={new Date(Date.now() - 864e5).toISOString().slice(0, 10)} style={{ width: "auto" }} /></label>
                <label style={{ margin: 0, flex: "1 1 160px" }}>Note<input name="note" placeholder="why (optional)" /></label>
                <button type="submit" style={{ margin: 0 }}>Queue backfill</button>
                <button formAction={runBackfillNow} style={{ margin: 0, background: "var(--panel2)", color: "var(--muted)", border: "1px solid var(--line)" }}>Run now</button>
              </form>
            )}
            {(jobs || []).length > 0 ? (
              <table style={{ marginTop: 10 }}>
                <thead><tr><th>Job</th><th>Range</th><th>Progress</th><th>Status</th><th style={{ whiteSpace: "normal" }}>Latest</th><th></th></tr></thead>
                <tbody>
                  {(jobs || []).map((j) => {
                    const pct = j.chunks ? Math.round((j.done / j.chunks) * 100) : 0;
                    const pill = j.status === "done" ? "fresh" : j.status === "active" ? (j.deferred > 0 ? "stale" : "on_track") : "pending";
                    const latest = j.status === "done" ? `${Number(j.rows_written).toLocaleString()} rows`
                      : j.deferred_until ? `waiting on quota until ${when(j.deferred_until)}`
                      : j.running > 0 ? `pulling ${j.next_chunk ? j.next_chunk.slice(0, 7) : ""}…`
                      : j.last_error ? j.last_error
                      : j.next_chunk ? `next: ${j.next_chunk.slice(0, 7)}` : "—";
                    return (
                      <tr key={j.id}>
                        <td>{j.source ? PLATFORM_NAME[j.source] || j.source : "All platforms"}{j.client_slug ? <span className="muted"> · {j.client_slug}</span> : <span className="muted"> · all clients</span>}
                          {j.note && <div className="muted" style={{ fontSize: 11, whiteSpace: "normal" }}>{j.note}</div>}</td>
                        <td style={{ fontSize: 12 }}>{j.start_date} → {j.end_date}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 90, height: 6, background: "var(--panel2)", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ width: `${pct}%`, height: "100%", background: j.status === "done" ? "var(--on)" : "var(--txt)" }} />
                            </div>
                            <span className="muted" style={{ fontSize: 12 }}>{j.done}/{j.chunks} months</span>
                          </div>
                        </td>
                        <td><span className={`pill ${pill}`}>{j.status === "active" && j.deferred > 0 ? "waiting" : j.status}</span></td>
                        <td className="muted" style={{ fontSize: 12, whiteSpace: "normal", maxWidth: 320 }}>{latest}</td>
                        <td>
                          {isAdmin && j.status !== "done" && j.status !== "cancelled" && (
                            <form action={setBackfillStatus} style={{ margin: 0, display: "flex", gap: 6 }}>
                              <input type="hidden" name="job_id" value={j.id} />
                              <button name="status" value={j.status === "paused" ? "active" : "paused"} style={{ margin: 0, padding: "4px 9px", background: "var(--panel2)", color: "var(--muted)", border: "1px solid var(--line)" }}>
                                {j.status === "paused" ? "Resume" : "Pause"}
                              </button>
                              <button name="status" value="cancelled" style={{ margin: 0, padding: "4px 9px", background: "var(--panel2)", color: "var(--off)", border: "1px solid var(--line)" }}>Cancel</button>
                            </form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>No backfills queued.</p>}
          </div>

    </AppShell>
  );
}
