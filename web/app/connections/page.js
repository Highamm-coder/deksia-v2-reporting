import { getSupabaseServer } from "../../lib/supabase/server";
import AppShell from "../_components/AppShell";
import { runConnectionTest } from "../data/actions";
import { mapDiscovered, setMappingActive, updateMapping, probeMapping, attachById,
         ignoreDiscovered, unignoreDiscovered, mapDiscoveredBulk, setMappingsActive } from "./actions";
import { UnmappedGrid, IgnoredGrid, MappedGrid } from "./Grids";

export const dynamic = "force-dynamic";
const when = (ts) => (ts ? new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const norm = (v) => String(v || "").replace(/\D/g, "") || String(v || "");
const PLATFORM_LABEL = { meta: "Meta Ads", pages: "Facebook Pages", google_ads: "Google Ads", ga4: "GA4", callrail: "CallRail", search_console: "Search Console", youtube: "YouTube" };

// A credential is what we rotate. Three of them; each a one-line summary, details on demand.
const PROVIDERS = [
  { key: "meta", label: "Meta", statusKey: "meta", secret: "META_ACCESS_TOKEN",
    how: "User access token minted as the agency Facebook user (social@deksia) with ads_read, read_insights, pages_read_engagement, business_management, then Extended. Data access lasts 90 days.",
    rotate: "Graph API Explorer → generate as social@deksia → Extend → `gh secret set META_ACCESS_TOKEN` → ⚡ Test connections." },
  { key: "google", label: "Google", statusKey: "google_oauth", secret: "GOOGLE_OAUTH_REFRESH_TOKEN (+ CLIENT_ID / CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID)",
    how: "One OAuth refresh token (Internal consent screen; never expires unless revoked) covers GA4, Google Ads, Search Console and YouTube. The Ads developer token has Explorer access: read-only with a daily operation cap.",
    rotate: "node orchestrator/get-refresh-token.mjs as the Google user that manages the MCC → `gh secret set GOOGLE_OAUTH_REFRESH_TOKEN` → ⚡ Test connections. Google/CallRail status pills only turn green after the next real read (tomorrow's run), not after a probe." },
  { key: "callrail", label: "CallRail", statusKey: "callrail", secret: "CALLRAIL_API_KEY",
    how: "Static API key on the Deksia CallRail account. No expiry.",
    rotate: "CallRail → Settings → API keys → `gh secret set CALLRAIL_API_KEY`." },
];
const pill = (status) => <span className={`pill ${status === "ok" ? "fresh" : status === "expired" ? "off_track" : "pending"}`}>{status || "unknown"}</span>;

export default async function Connections({ searchParams }) {
  const supabase = getSupabaseServer();
  const [{ data: status }, { data: sources }, { data: mappings }, { data: probes }, { data: disc }, { data: clients }, { data: isAdmin }, { data: statusRows }] = await Promise.all([
    supabase.from("connector_status").select("*"),
    supabase.from("v_sources").select("*").neq("source", "manual"),
    supabase.from("client_sources").select("id, client_id, source, external_id, active, params, clients(slug, name, status)"),
    supabase.from("connection_probes").select("*"),
    supabase.from("connector_discovery").select("*"),
    supabase.from("clients").select("id, slug, name").neq("status", "archived").order("name"),
    supabase.rpc("is_admin"),
    supabase.from("v_client_source_status").select("slug, source, sync_status"),
  ]);
  const statusBy = Object.fromEntries((status || []).map((s) => [s.provider, s]));
  const mappedKeys = new Set((mappings || []).map((m) => `${m.source}|${norm(m.external_id)}`));
  const unmapped = (disc || []).filter((d) => !d.ignored_at && !mappedKeys.has(`${d.source}|${norm(d.external_id)}`));
  const ignored = (disc || []).filter((d) => d.ignored_at && !mappedKeys.has(`${d.source}|${norm(d.external_id)}`));
  const yearStart = `${new Date().getUTCFullYear()}-01-01`;
  const msg = searchParams?.mapped ? [<>Mapped <strong>{searchParams.mapped}</strong>. {searchParams.probing ? "Probing now — the verdict lands in the row in about a minute (refresh)." : searchParams.probe_err ? `Couldn't start the probe (${searchParams.probe_err}); it's probed tonight.` : ""} <a href={`/data?client=${encodeURIComponent(searchParams.client || "")}&source=${encodeURIComponent(searchParams.source || "")}&start=${yearStart}#backfills`}>Queue a backfill for history →</a></>, "var(--on)"]
    : searchParams?.updated ? [`Updated${/^\d+$/.test(searchParams.updated) ? ` ${searchParams.updated}` : ""}.`, "var(--on)"]
    : searchParams?.probing ? [`Probing ${searchParams.probing} — the result lands in its row in about a minute. Refresh to see it.`, "var(--on)"]
    : searchParams?.err ? [`Couldn't do that: ${searchParams.err}`, "var(--off)"] : null;
  const actions = { mapDiscovered, setMappingActive, updateMapping, probeMapping, ignoreDiscovered, unignoreDiscovered, mapDiscoveredBulk, setMappingsActive };
  const warnProvider = searchParams?.warn ? (sources || []).find((x) => x.source === searchParams.source)?.provider : null;
  const activeSources = (sources || []).filter((x) => x.active);

  return (
    <AppShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 2px" }}>Connections</h1>
        {isAdmin && <form action={runConnectionTest} style={{ margin: 0 }}><button type="submit" style={{ margin: 0 }}>⚡ Test connections now</button></form>}
      </div>
      {msg && <div style={{ margin: "8px 0 0", fontSize: 13, color: msg[1] }}>{msg[0]}</div>}

      {/* credentials: one line each */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10, margin: "12px 0 6px" }}>
        {PROVIDERS.map((prov) => {
          const st = statusBy[prov.statusKey] || {};
          const provSources = (sources || []).filter((s) => s.provider === prov.key);
          const mapped = (mappings || []).filter((m) => m.active && provSources.some((s) => s.source === m.source)).length;
          const un = unmapped.filter((d) => d.provider === prov.key).length;
          const days = st.expires_at ? Math.round((new Date(st.expires_at) - Date.now()) / 864e5) : null;
          return (
            <details key={prov.key} className="card" style={{ maxWidth: "none", padding: "12px 14px" }}>
              <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 15 }}>{prov.label}</strong>
                {pill(st.status)}
                <span className="muted" style={{ fontSize: 12 }}>{st.identity ? st.identity.split(" (")[0] : "identity after next run"}</span>
                {days != null && <span className="muted" style={{ fontSize: 12 }}>· {days}d left</span>}
                <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>{mapped} mapped{un ? <span style={{ color: "var(--risk)", fontWeight: 600 }}> · {un} unmapped</span> : ""}</span>
              </summary>
              <div style={{ marginTop: 10, fontSize: 12.5 }} className="muted">
                <p style={{ margin: "0 0 6px" }}>{prov.how}</p>
                {isAdmin && <p style={{ margin: "0 0 6px" }}><strong>Secret:</strong> <code>{prov.secret}</code><br /><strong>Rotate:</strong> {prov.rotate}</p>}
                {isAdmin && st.scopes?.length > 0 && <p style={{ margin: "0 0 6px" }}><strong>Scopes:</strong> {st.scopes.join(", ")}</p>}
                <p style={{ margin: 0 }}>Sources: {provSources.map((s) => `${s.label}${s.active ? "" : " (planned)"}`).join(" · ")} · checked {when(st.checked_at)}</p>
              </div>
            </details>
          );
        })}
      </div>

      <UnmappedGrid rows={unmapped} clients={clients || []} isAdmin={!!isAdmin} actions={actions} />

      <details id="attach" open={!!searchParams?.warn} style={{ margin: "-10px 0 18px" }}>
        <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>Attach an account by ID (one discovery can&apos;t see)</summary>
        {isAdmin ? (
          <form action={attachById} className="card" style={{ maxWidth: "none", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
            {searchParams?.warn && (
              <div style={{ flexBasis: "100%", fontSize: 13, color: "var(--risk)", background: "rgba(169,118,0,.10)", padding: "8px 10px", borderRadius: 8 }}>
                <strong>{searchParams.external_id}</strong> isn&apos;t among the {PLATFORM_LABEL[searchParams.source] || searchParams.source} accounts the {warnProvider || ""} credential can see.
                Either the ID is wrong (property IDs are 9 digits, Ads customer IDs 10) or that user hasn&apos;t been granted access yet. Attach anyway if you&apos;re sure — it&apos;s probed immediately.
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
              <select name="source" defaultValue={searchParams?.warn ? searchParams.source : "ga4"} style={{ width: "auto" }}>
                {activeSources.map((x) => <option key={x.source} value={x.source}>{x.label}</option>)}
              </select>
            </label>
            <label style={{ margin: 0, flex: 1, minWidth: 200 }}>Account / property ID<input name="external_id" required defaultValue={searchParams?.warn ? searchParams.external_id : ""} placeholder="GA4 property 9 digits · Ads customer 10 digits · page / ad account digits · COM… for CallRail" /></label>
            <label style={{ margin: 0, minWidth: 150 }}>Label<input name="label" defaultValue={searchParams?.warn ? searchParams.label : ""} placeholder="how it shows on the client page" /></label>
            <label style={{ margin: 0, width: 160 }}>CallRail account ID<input name="account_id" defaultValue={searchParams?.warn ? searchParams.account_id : ""} placeholder="only for CallRail" /></label>
            <button type="submit" style={{ margin: 0 }}>{searchParams?.warn ? "Attach anyway" : "Attach & probe"}</button>
          </form>
        ) : <p className="muted" style={{ fontSize: 12 }}>Admins only.</p>}
      </details>

      <MappedGrid rows={mappings || []} probes={probes || []} statusRows={statusRows || []} isAdmin={!!isAdmin} actions={actions}
                  highlight={searchParams?.mapping} initialEdit={searchParams?.edit === "1" ? searchParams?.mapping : null} />

      {ignored.length > 0 && (
        <details style={{ marginTop: -6 }}>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>Ignored accounts ({ignored.length})</summary>
          <IgnoredGrid rows={ignored} isAdmin={!!isAdmin} actions={actions} />
        </details>
      )}
    </AppShell>
  );
}
