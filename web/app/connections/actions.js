"use server";
import { getSupabaseServer } from "../../lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const back = (q = "") => { revalidatePath("/connections"); redirect(`/connections${q}`); };

// Map a discovered account to a client. Discovery is what the credential can see; the
// mapping is what we pull. Same shape as onboarding's addSource, reached from the
// "discovered but not mapped" list.
export async function mapDiscovered(formData) {
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) back("?err=forbidden");
  const client_id = String(formData.get("client_id") || "");
  const source = String(formData.get("source") || "");
  const external_id = String(formData.get("external_id") || "").trim();
  const label = String(formData.get("label") || "").trim();
  const account_id = String(formData.get("account_id") || "").trim();   // CallRail parent account
  if (!client_id || !source || !external_id) back("?err=missing");
  const params = { confirmed: true, mapped_from: "connections/discovery" };
  if (label) params.label = label;
  if (account_id) params.account_id = account_id;
  const { error } = await supabase.from("client_sources").insert({ client_id, source, external_id, active: true, params });
  back(error ? `?err=${encodeURIComponent(error.message.slice(0, 120))}` : `?mapped=${encodeURIComponent(external_id)}`);
}

// Deactivate / reactivate a mapping (never deletes history).
export async function setMappingActive(formData) {
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) back("?err=forbidden");
  const id = String(formData.get("id"));
  const active = String(formData.get("active")) === "true";
  await supabase.from("client_sources").update({ active, updated_at: new Date().toISOString() }).eq("id", id);
  back("?updated=1");
}
