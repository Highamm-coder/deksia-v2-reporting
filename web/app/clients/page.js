import { getSupabaseServer } from "../../lib/supabase/server";
import AppShell from "../_components/AppShell";

export const dynamic = "force-dynamic";

export default async function Clients() {
  const supabase = getSupabaseServer();
  const { data } = await supabase
    .from("clients")
    .select("slug,name,status,timezone")
    .order("status")
    .order("slug");

  return (
    <AppShell>
        <h2>Clients ({data?.length ?? 0})</h2>
        <table>
          <thead><tr><th>Client</th><th>Name</th><th>Status</th><th>Timezone</th></tr></thead>
          <tbody>
            {(data || []).map((c) => (
              <tr key={c.slug}>
                <td><a href={`/clients/${encodeURIComponent(c.slug)}`}>{c.slug}</a></td>
                <td className="muted">{c.name || "—"}</td>
                <td><span className={`pill ${c.status === "active" ? "on_track" : "pending"}`}>{c.status}</span></td>
                <td className="muted">{c.timezone}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ marginTop: 14 }}>Add/edit clients & sources — coming in P2.</p>
    </AppShell>
  );
}
