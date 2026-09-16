import { NextResponse } from "next/server";
import { getSupabaseServer } from "../../../lib/supabase/server";

// Lands Supabase email links (signup confirmation + password recovery).
// Exchanges the one-time code for a session, then forwards:
//   recovery links carry ?next=/reset/update; confirmations go to the overview.
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/";
  // only allow same-site relative redirects
  const dest = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (code) {
    const supabase = getSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(dest, url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=1", url.origin));
}
