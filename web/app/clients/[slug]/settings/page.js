import { getSupabaseServer } from "../../../../lib/supabase/server";
import ScriptBlock from "../../../_components/ScriptBlock";
import { generateGoogleAdsScript } from "../../../../lib/googleAdsScript";
import { addDerived, setDerivedActive, setMetricDepth, repullClient } from "./actions";

export const dynamic = "force-dynamic";
const num = (v, d = 0) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

const TERM_LABEL = ({ source, metric }) => `${source} · ${String(metric).replace(/_/g, " ")}`;

export default async function SettingsTab({ params, searchParams }) {
  const slug = decodeURIComponent(params.slug);
  const supabase = getSupabaseServer();
  const [{ data: client }, { data: pipeline }, { data: prov }, { data: sumDefs }, { data: derivedDefs }] = await Promise.all([
    supabase.from("clients").select("*, client_sources(*)").eq("slug", slug).maybeSingle(),
    supabase.from("v_pipeline_health").select("*").eq("slug", slug).order("source"),
    supabase.from("v_client_provenance").select("*").eq("slug", slug).order("source"),
    supabase.from("metric_definitions").select("source, metric_name").eq("agg", "sum").order("source").order("metric_name"),
    supabase.from("derived_metrics").select("*").order("label"),
  ]);
  if (!client) return <p>Client not found.</p>;
  // formulas that apply here: global (client_id null) or scoped to this client
  const myDerived = (derivedDefs || []).filter((d) => !d.client_id || d.client_id === client.id);
  const dmsg = searchParams?.derr ? "Couldn't save — needs a name plus at least one numerator and one denominator metric."
    : searchParams?.dok ? "Computed metric added — it's live on the dashboard." : null;
  const sources = (client.client_sources || []).sort((a, b) => a.source.localeCompare(b.source) || String(a.external_id).localeCompare(String(b.external_id)));
  const gAdsScript = generateGoogleAdsScript(client.slug, client.name);

  // Meta depth: how many distinct metric names this client actually has stored, so the
  // choice is made against the real number rather than a promise about it.
  const metaSources = sources.filter((s) => s.source === "meta");
  const { data: nameRow } = metaSources.length
    ? await supabase.from("v_client_metric_names").select("metric_names")
        .eq("client_id", client.id).eq("source", "meta").maybeSingle()
    : { data: null };
  const metaNameCount = nameRow?.metric_names ?? 0;
  const DEPTH_MSG = {
    standard: ["Set to standard — the next pull stores the core conversion set.", "var(--on)"],
    full: ["Set to full — the next pull stores every action type Meta returns.", "var(--on)"],
    failed: ["Couldn't save the depth change.", "var(--off)"],
    forbidden: ["Admins only.", "var(--off)"],
  };
  const REPULL_MSG = {
    started: ["Re-pull queued on GitHub Actions — give it a few minutes, then reload.", "var(--on)"],
    notoken: ["No GITHUB_DISPATCH_TOKEN set — add it in Vercel to enable one-click re-pulls.", "var(--risk)"],
    baddate: ["Need both dates as YYYY-MM-DD.", "var(--off)"],
    forbidden: ["Admins only.", "var(--off)"],
    failed: [`GitHub rejected the request${searchParams?.why ? ` — ${searchParams.why}` : ""}.`, "var(--off)"],
  };
  const depthMsg = DEPTH_MSG[searchParams?.depth];
  const repullMsg = REPULL_MSG[searchParams?.repull];
  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${new Date().getUTCFullYear()}-01-01`;

  return (
    <>
      <h2>Sources & freshness</h2>
      <table>
        <thead><tr><th>Source</th><th>External ID</th><th>Status</th><th>Last data</th><th className="num">Rows 30d</th><th>Flags</th></tr></thead>
        <tbody>
          {sources.map((s) => {
            const p = (pipeline || []).find((x) => x.source === s.source);
            const flags = Object.entries(s.params || {})
              .filter(([k]) => ["confirmed", "unconfirmed", "brand", "state", "mcp_pending", "deactivated", "note"].includes(k))
              .map(([k, v]) => `${k}:${v}`).join("  ");
            return (
              <tr key={s.id}>
                <td>{s.source}{s.active ? "" : " (inactive)"}</td>
                <td className="muted">{s.external_id}</td>
                <td>{p ? <span className={`pill ${p.sync_status}`}>{p.sync_status?.replace("_", " ")}</span> : "—"}</td>
                <td>{p?.last_metric_date || "—"}</td>
                <td className="num">{num(p?.rows_30d)}</td>
                <td className="muted" style={{ whiteSpace: "normal", fontSize: 12 }}>{flags}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>Data provenance — where every number comes from</h2>
      <table>
        <thead><tr><th>Source</th><th>Account</th><th style={{ whiteSpace: "normal" }}>Method</th><th>Coverage</th><th>Last pulled</th><th>Written by</th></tr></thead>
        <tbody>
          {(prov || []).map((p) => (
            <tr key={`${p.source}|${p.account_ext_id}`}>
              <td className="muted">{p.source}</td>
              <td style={{ whiteSpace: "normal" }}>{p.account_label}{p.account_ext_id && p.account_label !== p.account_ext_id ? <span className="muted" style={{ fontSize: 11 }}> · {p.account_ext_id}</span> : null}</td>
              <td style={{ whiteSpace: "normal", fontSize: 12 }} className="muted">{p.method}<br /><span style={{ fontSize: 11 }}>{p.api} · {p.cadence}</span></td>
              <td style={{ fontSize: 12 }}>{p.first_day} → {p.last_day}</td>
              <td style={{ fontSize: 12 }}>{p.last_ingested ? new Date(p.last_ingested).toLocaleString() : "—"}</td>
              <td className="muted" style={{ fontSize: 12 }}>{(p.writers || []).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {metaSources.length > 0 && (
        <>
          <h2 id="metric-depth">Meta metric depth</h2>
          <p className="muted" style={{ margin: "0 0 8px", fontSize: 13 }}>
            Meta reports roughly 90 action types per account, and most are aliases of one another
            (<code>omni_landing_page_view</code> and <code>landing_page_view</code> are the same number) or
            vanity engagement. <strong>Standard</strong> stores the conversions an account is judged on —
            leads, lead-form and pixel leads, landing page views, purchase funnel, calls, messages,
            engagement — about 35 metric names. <strong>Full</strong> stores everything Meta returns,
            including its aliases and unnamed <code>offsite_conversion.custom.&lt;pixel-id&gt;</code> events.
            Nothing is computed or combined either way; this only decides what gets stored.
          </p>
          <p className="muted" style={{ margin: "0 0 8px", fontSize: 13 }}>
            This client currently has <strong>{metaNameCount}</strong> distinct Meta metric names in the
            last 90 days. Depth applies to future pulls only — use the re-pull below to apply it to history.
          </p>
          {depthMsg ? <div style={{ margin: "8px 0", fontSize: 13, color: depthMsg[1] }}>{depthMsg[0]}</div> : null}
          <table>
            <thead><tr><th>Ad account</th><th>Depth</th><th></th></tr></thead>
            <tbody>
              {metaSources.map((s) => {
                const d = s.params?.metric_depth === "full" ? "full" : "standard";
                return (
                  <tr key={s.id}>
                    <td className="muted">{s.external_id}</td>
                    <td>{d === "full" ? <span className="pill pending">full</span> : <span className="pill on_track">standard</span>}</td>
                    <td>
                      <form action={setMetricDepth} style={{ margin: 0 }}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="source_id" value={s.id} />
                        <input type="hidden" name="depth" value={d === "full" ? "standard" : "full"} />
                        <button type="submit" style={{ margin: 0, padding: "5px 10px", background: "var(--panel2)", color: "var(--muted)", border: "1px solid var(--line)" }}>
                          Switch to {d === "full" ? "standard" : "full"}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {repullMsg ? <div style={{ margin: "8px 0", fontSize: 13, color: repullMsg[1] }}>{repullMsg[0]}</div> : null}
          <form action={repullClient} className="card" style={{ maxWidth: "none", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 10 }}>
            <input type="hidden" name="slug" value={slug} />
            <label style={{ margin: 0 }}>Re-pull from<input type="date" name="start" defaultValue={yearStart} required style={{ width: "auto" }} /></label>
            <label style={{ margin: 0 }}>to<input type="date" name="end" defaultValue={today} required style={{ width: "auto" }} /></label>
            <button type="submit" style={{ margin: 0 }}>Re-pull this client</button>
            <span className="muted" style={{ fontSize: 12, flexBasis: "100%" }}>
              Pulls every source for {client.name} over that window and re-writes each day at the current
              depth. Idempotent — re-running a day overwrites it rather than double-counting.
            </span>
          </form>
        </>
      )}

      <h2 id="custom-metrics">Computed metrics — custom formulas</h2>
      <p className="muted" style={{ margin: "0 0 8px", fontSize: 13 }}>
        Ratio-of-sums formulas over platform numbers (e.g. Blended CPL = ad spend ÷ leads). Deksia-computed,
        always shown with the formula — never confused with a platform-reported value. Only additive metrics
        can be terms (rates like CTR can&apos;t be summed).
      </p>
      {dmsg ? <div style={{ margin: "8px 0", fontSize: 13, color: searchParams?.derr ? "var(--off)" : "var(--on)" }}>{dmsg}</div> : null}
      {myDerived.length > 0 && (
        <table>
          <thead><tr><th>Metric</th><th style={{ whiteSpace: "normal" }}>Formula</th><th>Scope</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {myDerived.map((d) => (
              <tr key={d.id} style={!d.active ? { opacity: 0.55 } : undefined}>
                <td>{d.label} <span className="muted" style={{ fontSize: 11 }}>({d.unit})</span></td>
                <td style={{ whiteSpace: "normal", fontSize: 12 }} className="muted">
                  ({(d.numerator || []).map(TERM_LABEL).join(" + ")}) ÷ ({(d.denominator || []).map(TERM_LABEL).join(" + ")})
                </td>
                <td className="muted">{d.client_id ? "this client" : "all clients"}</td>
                <td>{d.active ? <span className="pill on_track">active</span> : <span className="pill pending">archived</span>}</td>
                <td>
                  <form action={setDerivedActive} style={{ margin: 0 }}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="id" value={d.id} />
                    <input type="hidden" name="active" value={d.active ? "false" : "true"} />
                    <button type="submit" style={{ margin: 0, padding: "5px 10px", background: "var(--panel2)", color: "var(--muted)", border: "1px solid var(--line)" }}>
                      {d.active ? "Archive" : "Restore"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form action={addDerived} className="card" style={{ maxWidth: "none", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 10 }}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="client_id" value={client.id} />
        <label style={{ margin: 0 }}>Name<input name="label" placeholder="e.g. Cost per MQL" required style={{ width: 170 }} /></label>
        <label style={{ margin: 0 }}>Numerator <span className="muted">(⌘-click for multiple)</span>
          <select name="num" multiple required size={5} style={{ minWidth: 200 }}>
            {(sumDefs || []).map((d) => <option key={`${d.source}|${d.metric_name}`} value={`${d.source}|${d.metric_name}`}>{d.source} · {d.metric_name}</option>)}
          </select>
        </label>
        <label style={{ margin: 0 }}>÷ Denominator
          <select name="den" multiple required size={5} style={{ minWidth: 200 }}>
            {(sumDefs || []).map((d) => <option key={`${d.source}|${d.metric_name}`} value={`${d.source}|${d.metric_name}`}>{d.source} · {d.metric_name}</option>)}
          </select>
        </label>
        <label style={{ margin: 0 }}>Unit
          <select name="unit" defaultValue="usd" style={{ width: "auto" }}>
            <option value="usd">$ (cost per…)</option>
            <option value="ratio">× (ratio)</option>
            <option value="pct">%</option>
            <option value="int">count</option>
          </select>
        </label>
        <label style={{ margin: 0 }}>Applies to
          <select name="scope" defaultValue="client" style={{ width: "auto" }}>
            <option value="client">this client only</option>
            <option value="all">all clients</option>
          </select>
        </label>
        <button type="submit" style={{ margin: 0 }}>Add computed metric</button>
      </form>

      <h2>Google Ads — account we don&apos;t manage</h2>
      <p className="muted" style={{ margin: "0 0 8px", fontSize: 13 }}>
        For a Google Ads account not under the Deksia MCC, generate this client-specific script and
        have whoever manages that account paste it into <strong>Google Ads → Tools → Bulk actions →
        Scripts → New script</strong>, then Authorize → Run once → schedule Daily. Replace{" "}
        <code>PASTE_INGEST_TOKEN</code> with the current ingest token before installing.
      </p>
      <ScriptBlock code={gAdsScript} filename={`google-ads-${client.slug}.js`} />
    </>
  );
}
