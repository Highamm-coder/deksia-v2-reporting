"use server";
import { getSupabaseServer } from "../../lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const back = () => { revalidatePath("/admin"); redirect("/admin"); };

// Ban / unban a user (admin-gated in the DB function; can't ban yourself).
export async function setUserBan(formData) {
  const supabase = getSupabaseServer();
  await supabase.rpc("admin_set_ban", {
    p_user_id: String(formData.get("user_id")),
    p_banned: String(formData.get("banned")) === "true",
  });
  return back();
}

// Resolve / reopen a bug report.
export async function setBugStatus(formData) {
  const supabase = getSupabaseServer();
  const status = formData.get("status") === "resolved" ? "resolved" : "open";
  await supabase.from("bug_reports").update({
    status, resolved_at: status === "resolved" ? new Date().toISOString() : null,
  }).eq("id", Number(formData.get("id")));
  return back();
}

// Grant / revoke admin.
export async function addAdmin(formData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email.endsWith("@deksia.com")) return back();
  const supabase = getSupabaseServer();
  await supabase.from("admins").insert({ email });
  return back();
}

export async function removeAdmin(formData) {
  const supabase = getSupabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  const email = String(formData.get("email"));
  if (email === auth?.user?.email) return back(); // can't remove yourself
  await supabase.from("admins").delete().eq("email", email);
  return back();
}
