import { getSupabaseServer } from "../../../lib/supabase/server";
import AppShell from "../../_components/AppShell";

export const dynamic = "force-dynamic";

// Shared chrome for every client page: title + settings link. (The month picker
// returns here in the month-aware data phase, once changing it actually re-scopes
// the data — an inert control erodes trust.)
export default async function ClientLayout({ children, params }) {
  const slug = decodeURIComponent(params.slug);
  const supabase = getSupabaseServer();
  const { data: client } = await supabase
    .from("clients").select("id, slug, name, status, timezone").eq("slug", slug).maybeSingle();

  if (!client) {
    return (<AppShell><p className="muted"><a href="/clients">← Clients</a></p><p>Client not found: {slug}</p></AppShell>);
  }

  return (
    <AppShell>
        <p className="muted"><a href="/clients">← Clients</a></p>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
          <h1 style={{ margin: "4px 0" }}>{client.name || client.slug}{" "}
            <span className="muted" style={{ fontSize: 13 }}>· {client.status} · {client.timezone}</span></h1>
          <a href={`/clients/${encodeURIComponent(client.slug)}/settings`} className="muted" style={{ fontSize: 13 }}>⚙ Settings</a>
        </div>
        {children}
    </AppShell>
  );
}
