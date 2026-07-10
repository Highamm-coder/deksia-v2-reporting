import { getSupabaseServer } from "../../lib/supabase/server";
import Sidebar from "./Sidebar";

// Authenticated app frame: light page → dark rounded panel → left sidebar + content.
// Fetches the client roster once (28 rows) to power the sidebar quick-search, and the
// latest ingest time for the live freshness card.
export default async function AppShell({ children }) {
  const supabase = getSupabaseServer();
  const [{ data: clients }, { data: last }] = await Promise.all([
    supabase.from("clients").select("slug, name, status").order("slug"),
    supabase.from("v_pipeline_health").select("last_ingested_at").order("last_ingested_at", { ascending: false }).limit(1),
  ]);
  const lastSync = last?.[0]?.last_ingested_at || null;

  return (
    <div className="page">
      <div className="app">
        <Sidebar clients={clients || []} lastSync={lastSync} />
        <div className="content">
          <main>{children}</main>
        </div>
      </div>
    </div>
  );
}
