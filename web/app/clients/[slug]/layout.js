import { getSupabaseServer } from "../../../lib/supabase/server";
import { requireData } from "../../../lib/readAll.mjs";
import AppShell from "../../_components/AppShell";

export const dynamic = "force-dynamic";

// Shared chrome for every client page: title + settings link. (The month picker
// returns here in the month-aware data phase, once changing it actually re-scopes
// the data — an inert control erodes trust.)
export default async function ClientLayout({ children, params }) {
  const slug = decodeURIComponent(params.slug);
  const supabase = getSupabaseServer();
  const client = await requireData(supabase.from("clients").select("id, slug, name, status, timezone").eq("slug", slug).maybeSingle(), "Client");

  if (!client) {
    return (<AppShell><p className="muted"><a href="/clients">← Clients</a></p><p>Client not found: {slug}</p></AppShell>);
  }

  return (
    <AppShell>
        <p style={{ margin: "0 0 6px" }}><a href="/clients" style={{ fontSize: 13, fontWeight: 600 }}>← Clients</a></p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 28, letterSpacing: "-.01em" }}>{client.name || client.slug}</h1>
            <span className={`pill ${client.status === "active" ? "on_track" : "pending"}`}>{client.status}</span>
            {client.timezone && <span className="muted" style={{ fontSize: 13 }}>· {client.timezone}</span>}
          </div>
          <a href={`/clients/${encodeURIComponent(client.slug)}/settings`} className="btn-ghost">⚙ Settings</a>
        </div>
        {children}
    </AppShell>
  );
}
