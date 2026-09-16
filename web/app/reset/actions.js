"use server";
import { getSupabaseServer } from "../../lib/supabase/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

// Request a password-reset email. Always reports success (no account enumeration).
export async function requestReset(formData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const origin = headers().get("origin") || "http://localhost:3000";
  const supabase = getSupabaseServer();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset/update`,
  });
  redirect("/reset?sent=1");
}

// Set a new password — requires an active session (normal login OR the recovery
// session created by the email link via /auth/callback). Used from /reset/update
// and /account; a hidden "from" field routes errors back to the right page.
export async function updatePassword(formData) {
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  const back = formData.get("from") === "account" ? "/account" : "/reset/update";
  if (password.length < 8) redirect(`${back}?error=weak`);
  if (password !== confirm) redirect(`${back}?error=match`);
  const supabase = getSupabaseServer();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect(`${back}?error=1`);
  redirect("/account?ok=1");
}
