import { getSupabaseServer } from "../../../../lib/supabase/server";
import ScriptBlock from "../../../_components/ScriptBlock";
import { generateGoogleAdsScript } from "../../../../lib/googleAdsScript";

export const dynamic = "force-dynamic";
const num = (v, d = 0) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

export default async function SettingsTab({ params }) {
  const slug = decodeURIComponent(params.slug);
  const supabase = getSupabaseServer();
  const [{ data: client }, { data: pipeline }] = await Promise.all([
    supabase.from("clients").select("*, client_sources(*)").eq("slug", slug).maybeSingle(),
    supabase.from("v_pipeline_health").select("*").eq("slug", slug).order("source"),
  ]);
  if (!client) return <p>Client not found.</p>;
  const sources = (client.client_sources || []).sort((a, b) => a.source.localeCompare(b.source) || String(a.external_id).localeCompare(String(b.external_id)));
  const gAdsScript = generateGoogleAdsScript(client.slug, client.name);

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
