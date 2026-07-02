"use server";
import { getSupabaseServer } from "../../lib/supabase/server";
import { redirect } from "next/navigation";

export async function login(formData) {
  const supabase = getSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email") || ""),
    password: String(formData.get("password") || ""),
  });
  // generic error — never surface provider error text to the URL/UI
  if (error) redirect("/login?error=1");
  redirect("/");
}

export async function logout() {
  const supabase = getSupabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
