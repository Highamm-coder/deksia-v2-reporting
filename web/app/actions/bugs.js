"use server";
import { getSupabaseServer } from "../../lib/supabase/server";

// Insert a bug report as the signed-in user; the DB trigger emails it out.
export async function reportBug(formData) {
  const title = String(formData.get("title") || "").trim().slice(0, 120);
  const detail = String(formData.get("detail") || "").trim().slice(0, 2000) || null;
  const page = String(formData.get("page") || "").slice(0, 200) || null;
  if (!title) return { ok: false };
  const supabase = getSupabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  const reporter = auth?.user?.email || "unknown";
  const { error } = await supabase.from("bug_reports").insert({ reporter, page, title, detail });
  return { ok: !error };
}
