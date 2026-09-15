import { getSupabaseServer } from "../../lib/supabase/server";
import AppShell from "../_components/AppShell";
import { runConnectionTest } from "../data/actions";
import { mapDiscovered, setMappingActive, updateMapping, probeMapping, attachById } from "./actions";

export const dynamic = "force-dynamic";
const when = (ts) => (ts ? new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const norm = (v) => String(v || "").replace(/\D/g, "") || String(v || "");

// One card per credential family. A credential is a thing you rotate; a source is a thing
// you pull; a mapping is an account attached to a client. This page shows all three and
// the gap between "what the credential can see" and "what we actually pull".
const PROVIDERS = [
  { key: "meta", label: "Meta", statusKey: "meta", secret: "META_ACCESS_TOKEN",
    how: "User access token minted as the agency Facebook user (social@deksia) with ads_read, read_insights, pages_read_engagement, business_management — then Extended. Data access lasts 90 days.",
    rotate: "Graph API Explorer → generate as social@deksia → Extend → `gh secret set META_ACCESS_TOKEN`. Then ⚡ Test connections." },
  { key: "google", label: "Google", statusKey: "google_oauth", secret: "GOOGLE_OAUTH_REFRESH_TOKEN (+ CLIENT_ID / CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID)",
    how: "One OAuth refresh token (Internal consent screen, never expires unless revoked) covers GA4, Google Ads, Search Console and YouTube. The Ads developer token has Explorer access: read-only, daily operation cap.",
    rotate: "node orchestrator/get-refresh-token.mjs as the Google user that manages the MCC → `gh secret set GOOGLE_OAUTH_REFRESH_TOKEN`. Then ⚡ Test connections." },
  { key: "callrail", label: "CallRail", statusKey: "callrail", secret: "CALLRAIL_API_KEY",
    how: "Static API key on the Deksia CallRail account. No expiry.",
    rotate: "CallRail → Settings → API keys → `gh secret set CALLRAIL_API_KEY`." },
];

const PLATFORM_LABEL = { meta: "Meta Ads", pages: "Facebook Pages", google_ads: "Google Ads", ga4: "GA4", callrail: "CallRail", search_console: "Search Console", youtube: "YouTube" };

function pill(status) {
  const cls = status === "ok" ? "fresh" : status === "expired" ? "off_track" : "pending";
  return <span className={`pill ${cls}`}>{status || "unknown"}</span>;
}

export default async function Connections({ searchParams }) {
  const supabase = getSupabaseServer();
  const [{ data: status }, { data: sources }, { data: mappings }, { data: probes }, { data: disc }, { data: clients }, { data: isAdmin }] = await Promise.all([
    supabase.from("connector_status").select("*"),
    supabase.from("v_sources").select("*").neq("source", "manual"),
    supabase.from("client_sources").select("id, client_id, source, external_id, active, params, clients(slug, name, status)"),
    supabase.from("connection_probes").select("*"),
    supabase.from("connector_discovery").select("*").order("source").order("name"),
    supabase.from("clients").select("id, slug, name").neq("status", "archived").order("name"),
    supabase.rpc("is_admin"),
  ]);
  const statusBy = Object.fromEntries((status || []).map((s) => [s.provider, s]));
  const mappedKeys = new Set((mappings || []).map((m) => `${m.source}|${norm(m.external_id)}`));
  const probeFor = (source, ext) => (probes || []).find((p) => p.source === source && norm(p.external_id) === norm(ext));
  const yearStart = `${new Date().getUTCFullYear()}-01-01`;
  const msg = searchParams?.mapped ? [<>Mapped <strong>{searchParams.mapped}</strong>. {searchParams.probing ? "Probing it now — the verdict lands in its row in about a minute (refresh)." : searchParams.probe_err ? `Couldn't start the probe (${searchParams.probe_err}); it's probed tonight.` : ""} It's pulled from tomorrow&apos;s run. <a href={`/data?client=${encodeURIComponent(searchParams.client || "")}&source=${encodeURIComponent(searchParams.source || "")}&start=${yearStart}#backfills`}>Queue a backfill for its history →</a></>, "var(--on)"]
    : searchParams?.updated ? ["Updated.", "var(--on)"]
    : searchParams?.probing ? [`Probing ${searchParams.probing} — the result lands in its row in about a minute. Refresh to see it.`, "var(--on)"]
    : searchParams?.err ? [`Couldn't do that: ${searchParams.err}`, "var(--off)"] : null;

  return (
    <AppShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 2px" }}>Connections</h1>
        {isAdmin && <form action={runConnectionTest} style={{ margin: 0 }}><button type="submit" style={{ margin: 0 }}>⚡ Test connections now</button></form>}
      </div>
      <p className="muted" style={{ margin: "4px 0 14px", fontSize: 13 }}>
        A <strong>credential</strong> is what we rotate. A <strong>source</strong> is what we pull with it. A <strong>mapping</strong> attaches one
        account to one client. Below each credential: who it is, what it can see, and what we&apos;re not yet pulling.
      </p>
      {msg && <div style={{ margin: "0 0 12px", fontSize: 13, color: msg[1] }}>{msg[0]}</div>}

      {PROVIDERS.map((prov) => {
        const st = statusBy[prov.statusKey] || {};
        const provSources = (sources || []).filter((s) => s.provider === prov.key);
        const provMappings = (mappings || []).filter((m) => provSources.some((s) => s.source === m.source));
        const unmapped = (disc || []).filter((d) => d.provider === prov.key && !mappedKeys.has(`${d.source}|${norm(d.external_id)}`));
        const days = st.expires_at ? Math.round((new Date(st.expires_at) - Date.now()) / 864e5) : null;
        return (
          <section key={prov.key} className="card" style={{ maxWidth: "none", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0 }}>{prov.label}</h2>
              {pill(st.status)}
              {st.identity && <span style={{ fontSize: 13 }}>signed in as <strong>{st.identity}</strong></span>}
              {!st.identity && <span className="muted" style={{ fontSize: 12 }}>identity appears after the next nightly run</span>}
              {days != null && <span className="muted" style={{ fontSize: 12 }}>· expires in {days}d ({new Date(st.expires_at).toLocaleDateString()})</span>}
              <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>checked {when(st.checked_at)}</span>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 4px" }}>{prov.how}</p>
            <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}><strong>Secret:</strong> <code>{prov.secret}</code> · <strong>Rotate:</strong> {prov.rotate}</p>
            {st.scopes?.length > 0 && <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}><strong>Scopes granted:</strong> {st.scopes.join(", ")}</p>}

            <table>
              <thead><tr><th>Source</th><th>Status</th><th className="num">Mapped</th><th className="num">Visible, not mapped</th><th style={{ whiteSpace: "normal" }}>Lag</th></tr></thead>
              <tbody>
                {provSources.map((s) => {
                  const n = provMappings.filter((m) => m.source === s.source && m.active).length;
                  const u = unmapped.filter((d) => d.source === s.source).length;
                  return (
                    <tr key={s.source}>
                      <td>{s.label}</td>
                      <td>{s.active ? <span className="pill fresh">pulling</span> : <span className="pill pending">not built yet</span>}</td>
                      <td className="num">{n}</td>
                      <td className="num" style={u ? { color: "var(--risk)", fontWeight: 600 } : undefined}>{u}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{s.lag_days ? `${s.lag_days} day${s.lag_days > 1 ? "s" : ""} behind` : "next day"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {unmapped.length > 0 && (
              <>
                <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Visible to this credential, not mapped to a client</h3>
                <table>
                  <thead><tr><th>Source</th><th>Account</th><th>ID</th><th>Seen</th><th>Map to</th></tr></thead>
                  <tbody>
                    {unmapped.map((d) => (
                      <tr key={`${d.source}|${d.external_id}`}>
                        <td className="muted">{d.source}</td>
                        <td style={{ whiteSpace: "normal" }}>{d.name || "—"}{d.extra?.business ? <span className="muted"> · {d.extra.business}</span> : null}{d.extra?.account ? <span className="muted"> · {d.extra.account}</span> : null}</td>
                        <td className="muted" style={{ fontSize: 12 }}>{d.external_id}</td>
                        <td className="muted" style={{ fontSize: 12 }}>{when(d.last_seen)}</td>
                        <td>
                          {isAdmin ? (
                            <form action={mapDiscovered} style={{ margin: 0, display: "flex", gap: 6 }}>
                              <input type="hidden" name="source" value={d.source} />
                              <input type="hidden" name="external_id" value={d.external_id} />
                              <input type="hidden" name="label" value={d.name || ""} />
                              {d.extra?.account_id && <input type="hidden" name="account_id" value={d.extra.account_id} />}
                              <select name="client_id" defaultValue="" required style={{ width: "auto", maxWidth: 200, margin: 0 }}>
                                <option value="" disabled>client…</option>
                                {(clients || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </select>
                              <button type="submit" style={{ margin: 0, padding: "4px 9px" }}>Map</button>
                            </form>
                          ) : <span className="muted">admins only</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            <details id={prov.key === (searchParams?.source ? (sources || []).find((x) => x.source === searchParams.source)?.provider : "") ? "attach" : undefined}
                     open={!!(searchParams?.warn && (sources || []).find((x) => x.source === searchParams.source)?.provider === prov.key)}
                     style={{ marginTop: 12 }}>
              <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>Attach an account by ID (for one discovery can&apos;t see)</summary>
              {isAdmin ? (
                <form action={attachById} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", margin: "8px 0 0" }}>
                  {searchParams?.warn && (sources || []).find((x) => x.source === searchParams.source)?.provider === prov.key && (
                    <div style={{ flexBasis: "100%", fontSize: 13, color: "var(--risk)", background: "rgba(169,118,0,.10)", padding: "8px 10px", borderRadius: 8 }}>
                      <strong>{searchParams.external_id}</strong> isn&apos;t among the {PLATFORM_LABEL[searchParams.source] || searchParams.source} accounts this credential can see.
                      Either the ID is wrong (check it digit by digit — property IDs are 9 digits, Ads customer IDs 10) or the {prov.label} user hasn&apos;t been granted access yet.
                      Attach anyway if you&apos;re sure; it&apos;s probed immediately either way.
                      <input type="hidden" name="confirm" value="1" />
                    </div>
                  )}
                  <label style={{ margin: 0 }}>Client
                    <select name="client_id" required defaultValue={searchParams?.warn ? searchParams.client_id : (clients || []).find((c) => c.slug === searchParams?.client)?.id || ""} style={{ minWidth: 180 }}>
                      <option value="" disabled>Select…</option>
                      {(clients || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                  <label style={{ margin: 0 }}>Source
                    <select name="source" defaultValue={searchParams?.warn ? searchParams.source : provSources.find((x) => x.active)?.source || ""} style={{ width: "auto" }}>
                      {provSources.filter((x) => x.active).map((x) => <option key={x.source} value={x.source}>{x.label}</option>)}
                    </select>
                  </label>
                  <label style={{ margin: 0, flex: 1, minWidth: 200 }}>Account / property ID<input name="external_id" required defaultValue={searchParams?.warn ? searchParams.external_id : ""} placeholder={prov.key === "google" ? "GA4 property 9 digits · Ads customer 10 digits" : prov.key === "meta" ? "ad account / page ID (digits)" : "company ID (COM…)"} /></label>
                  <label style={{ margin: 0, minWidth: 150 }}>Label<input name="label" defaultValue={searchParams?.warn ? searchParams.label : ""} placeholder="how it shows on the client page" /></label>
                  {prov.key === "callrail" && <label style={{ margin: 0, width: 160 }}>CallRail account ID<input name="account_id" defaultValue={searchParams?.warn ? searchParams.account_id : ""} placeholder="ACC…" /></label>}
                  <button type="submit" style={{ margin: 0 }}>{searchParams?.warn && (sources || []).find((x) => x.source === searchParams.source)?.provider === prov.key ? "Attach anyway" : "Attach & probe"}</button>
                </form>
              ) : <p className="muted" style={{ fontSize: 12 }}>Admins only.</p>}
            </details>

            <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Mapped accounts</h3>
            <table>
              <thead><tr><th>Client</th><th>Source</th><th>Account</th><th>Last probe</th><th></th></tr></thead>
              <tbody>
                {provMappings.sort((a, b) => (a.clients?.name || "").localeCompare(b.clients?.name || "") || a.source.localeCompare(b.source)).map((m) => {
                  const p = probeFor(m.source, m.external_id);
                  return (
                    <tr key={m.id} id={`mapping-${m.id}`} style={{ ...(!m.active ? { opacity: 0.55 } : {}), ...(String(searchParams?.mapping || "") === String(m.id) ? { outline: "2px solid var(--txt)", outlineOffset: -2, background: "var(--panel2)" } : (searchParams?.client && m.clients?.slug === searchParams.client ? { background: "var(--panel2)" } : {})) }}>
                      <td>{m.clients?.name || "—"}</td>
                      <td className="muted">{m.source}</td>
                      <td style={{ whiteSpace: "normal", fontSize: 12 }}>
                        {isAdmin ? (
                          <form action={updateMapping} id={`edit-${m.id}`} style={{ margin: 0, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            <input type="hidden" name="id" value={m.id} />
                            <input name="label" defaultValue={m.params?.label || ""} placeholder="label" style={{ width: 150, margin: 0, padding: "4px 7px", fontSize: 12 }} />
                            <input name="external_id" defaultValue={m.external_id} required style={{ width: 150, margin: 0, padding: "4px 7px", fontSize: 12, fontFamily: "ui-monospace, monospace" }} />
                            <button type="submit" style={{ margin: 0, padding: "4px 9px" }}>Save</button>
                          </form>
                        ) : (m.params?.label ? <>{m.params.label} <span className="muted">· {m.external_id}</span></> : m.external_id)}
                        {m.params?.previous_ids?.length > 0 && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>was {m.params.previous_ids.map((p) => p.id).join(", ")}</div>}
                      </td>
                      <td style={{ whiteSpace: "normal", fontSize: 12 }}>
                        {!m.active ? <span className="muted">inactive</span>
                          : p ? <><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 99, background: p.reachable ? "var(--on)" : "var(--off)", marginRight: 6 }} />{p.detail}</>
                          : <span className="muted">not probed yet</span>}
                      </td>
                      <td>
                        {isAdmin && (
                          <div style={{ display: "flex", gap: 6 }}>
                            {m.active && (
                              <form action={probeMapping} style={{ margin: 0 }}>
                                <input type="hidden" name="slug" value={m.clients?.slug || ""} />
                                <input type="hidden" name="source" value={m.source} />
                                <input type="hidden" name="external_id" value={m.external_id} />
                                <button type="submit" title="Probe this account now (~1 min)" style={{ margin: 0, padding: "4px 9px" }}>Try again</button>
                              </form>
                            )}
                            <form action={setMappingActive} style={{ margin: 0 }}>
                              <input type="hidden" name="id" value={m.id} />
                              <input type="hidden" name="active" value={m.active ? "false" : "true"} />
                              <button type="submit" style={{ margin: 0, padding: "4px 9px", background: "var(--panel2)", color: "var(--muted)", border: "1px solid var(--line)" }}>
                                {m.active ? "Deactivate" : "Reactivate"}
                              </button>
                            </form>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </AppShell>
  );
}
