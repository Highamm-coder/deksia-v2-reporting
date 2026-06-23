import { createBrowserClient } from "@supabase/ssr";

// Browser Supabase client (for client components / interactive forms).
export function getSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
