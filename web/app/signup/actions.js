"use server";
import { getSupabaseServer } from "../../lib/supabase/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function signup(formData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  // friendly gate — the hard enforcement is a DB trigger on auth.users (0011)
  if (!/@deksia\.com$/.test(email)) redirect("/signup?error=domain");
  if (password.length < 8) redirect("/signup?error=weak");

  const origin = headers().get("origin") || "http://localhost:3000";
  const supabase = getSupabaseServer();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  // generic error — never surface provider text
  if (error) redirect("/signup?error=1");
  redirect("/signup?sent=1");
}
