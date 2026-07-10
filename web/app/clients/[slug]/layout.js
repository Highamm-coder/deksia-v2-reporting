import { getSupabaseServer } from "../../../lib/supabase/server";
import AppShell from "../../_components/AppShell";
import MonthPicker from "./MonthPicker";

export const dynamic = "force-dynamic";

// Shared chrome for every client tab: title, tab bar, month picker. Each tab page
// (children) fetches its own data for the selected ?month=.
export default async function ClientLayout({ children, params }) {
  const slug = decodeURIComponent(params.slug);
  const supabase = getSupabaseServer();
  const { data: client } = await supabase
    .from("clients").select("id, slug, name, status, timezone").eq("slug", slug).maybeSingle();

  if (!client) {
    return (<AppShell><p className="muted"><a href="/clients">← Clients</a></p><p>Client not found: {slug}</p></AppShell>);
  }

  // distinct months with data for this client (latest first) → month picker options
  const { data: monthRows } = await supabase
    .from("metrics_monthly").select("month_start").eq("client_id", client.id)
    .order("month_start", { ascending: false });
  const months = [...new Set((monthRows || []).map((r) => String(r.month_start).slice(0, 7)))];

  return (
    <AppShell>
        <p className="muted"><a href="/clients">← Clients</a></p>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
          <h1 style={{ margin: "4px 0" }}>{client.name || client.slug}{" "}
            <span className="muted" style={{ fontSize: 13 }}>· {client.status} · {client.timezone}</span></h1>
          <span style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <MonthPicker months={months} />
            <a href={`/clients/${encodeURIComponent(client.slug)}/settings`} className="muted" style={{ fontSize: 13 }}>⚙ Settings</a>
          </span>
        </div>
        {children}
    </AppShell>
  );
}
