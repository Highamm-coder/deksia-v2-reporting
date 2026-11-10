"use server";
import { revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseServer } from "../../../lib/supabase/server";
import { LIVE_TAG } from "../../../lib/live";

// Drop every cached live figure so the next view asks the vendors again. Admin only.
// This clears a cache; it writes nothing to the database.
export async function refreshLive(formData) {
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin) revalidateTag(LIVE_TAG);
  const sp = new URLSearchParams();
  const client = String(formData.get("client") || "");
  const month = String(formData.get("month") || "");
  if (client) sp.set("client", client);
  if (/^\d{4}-\d{2}$/.test(month)) sp.set("month", month);
  redirect(`/admin/live?${sp.toString()}`);
}
