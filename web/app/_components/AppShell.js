import { getSupabaseServer } from "../../lib/supabase/server";
import Sidebar from "./Sidebar";
import BugButton from "./BugButton";

// Authenticated app frame: light page → dark rounded panel → left sidebar + content.
// Fetches the client roster once (28 rows) to power the sidebar quick-search, and the
// latest ingest time for the live freshness card.
export default async function AppShell({ children }) {
  const supabase = getSupabaseServer();
  // One request for the whole sidebar, instead of five queries plus an auth-server call on every
  // page — they competed for PostgREST's 10 connections with the page's own data (migration 0077).
  // The e-mail comes from the JWT PostgREST has verified; middleware has already gated the request.
  // GET, not the default POST: supabase-js only retries GETs, and the old separate reads were GETs.
  const { data: shell, error: shellError } = await supabase.rpc("app_shell_data", {}, { get: true });
  // One call now feeds the whole sidebar, so a failure must say so — an absent credential warning
  // would otherwise read as "credentials fine".
  const shellFailed = !!shellError || !shell;
  const clients = shell?.clients || null;
  const creds = shell?.creds || null;
  const isAdmin = shell?.is_admin || false;
  const integrity = shell?.integrity || null;
  const lastSync = shell?.last_sync || null;
  const email = shell?.email || null;
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
        <Sidebar clients={clients || []} lastSync={lastSync} email={email} credWarning={isAdmin ? credWarning : null} integrity={integrity} isAdmin={!!isAdmin} shellFailed={shellFailed} />
        <div className="content">
          <main>{children}</main>
        </div>
        <BugButton />
      </div>
    </div>
  );
}
