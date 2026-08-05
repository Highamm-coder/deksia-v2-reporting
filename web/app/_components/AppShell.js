import { getSupabaseServer } from "../../lib/supabase/server";
import Sidebar from "./Sidebar";
import BugButton from "./BugButton";

// Authenticated app frame: light page → dark rounded panel → left sidebar + content.
// Fetches the client roster once (28 rows) to power the sidebar quick-search, and the
// latest ingest time for the live freshness card.
export default async function AppShell({ children }) {
  const supabase = getSupabaseServer();
  const [{ data: clients }, { data: last }, { data: auth }, { data: creds }, { data: checks }, { data: isAdmin }] = await Promise.all([
    supabase.from("clients").select("slug, name, status").order("slug"),
    supabase.from("v_pipeline_health").select("last_ingested_at").order("last_ingested_at", { ascending: false }).limit(1),
    supabase.auth.getUser(),
    supabase.from("connector_status").select("provider, status, expires_at"),
    supabase.from("integrity_checks").select("status, checked_at").order("checked_at", { ascending: false }).limit(1),
    supabase.rpc("is_admin"),
  ]);
  const integrity = checks?.[0] || null;
  const lastSync = last?.[0]?.last_ingested_at || null;
  const email = auth?.user?.email || null;
  // sidebar warning when any credential is expired or inside 14 days
  let credWarning = null;
  (creds || []).forEach((c) => {
    const days = c.expires_at ? Math.round((new Date(c.expires_at) - Date.now()) / 864e5) : null;
    if (c.status === "expired" || (days != null && days <= 0)) credWarning = `${c.provider} token EXPIRED`;
    else if (days != null && days <= 14 && !credWarning) credWarning = `${c.provider} token expires in ${days}d`;
  });

  return (
    <div className="page">
      <div className="app">
        <Sidebar clients={clients || []} lastSync={lastSync} email={email} credWarning={credWarning} integrity={integrity} isAdmin={!!isAdmin} />
        <div className="content">
          <main>{children}</main>
        </div>
        <BugButton />
      </div>
    </div>
  );
}
