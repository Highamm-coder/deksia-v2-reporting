import { getSupabaseServer } from "../../lib/supabase/server";
import AppShell from "../_components/AppShell";

export const dynamic = "force-dynamic";

// Deliberately minimal (per Matt): just the client roster and a way into each
// dashboard. Triage numbers live on the Scoreboard and each client's page.
export default async function Clients() {
  const supabase = getSupabaseServer();
  const { data: clients } = await supabase
    .from("clients").select("slug, name, status").order("status").order("slug");

  return (
    <AppShell>
      <h1 style={{ fontSize: 24, margin: "0 0 12px" }}>Clients</h1>
      <table>
        <thead><tr><th>Client</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {(clients || []).map((c) => (
            <tr key={c.slug}>
              <td><a href={`/clients/${encodeURIComponent(c.slug)}`}>{c.name || c.slug}</a>
                {c.name && c.name !== c.slug && <span className="muted" style={{ fontSize: 12 }}> · {c.slug}</span>}</td>
              <td><span className={`pill ${c.status === "active" ? "fresh" : "pending"}`}>{c.status}</span></td>
              <td><a href={`/clients/${encodeURIComponent(c.slug)}`} style={{ fontSize: 12.5 }}>View dashboard →</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </AppShell>
  );
}
