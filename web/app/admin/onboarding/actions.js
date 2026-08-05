"use server";
import { getSupabaseServer } from "../../../lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const SOURCES = ["google_ads", "meta", "ga4", "callrail", "pages"];
const back = (q = "") => { revalidatePath("/admin/onboarding"); redirect(`/admin/onboarding${q}`); };

async function adminGuard(supabase) {
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) back("?err=forbidden");
}

// Create a client shell. Sources get attached after.
export async function createClient(formData) {
  const supabase = getSupabaseServer();
  await adminGuard(supabase);
  const name = String(formData.get("name") || "").trim();
  const slug = (String(formData.get("slug") || "").trim() || name).slice(0, 40);
  const timezone = String(formData.get("timezone") || "America/Detroit");
  if (!name || !slug) return back("?err=missing");
  const { error } = await supabase.from("clients")
    .insert({ slug, name, status: "active", timezone });
  return back(error ? "?err=client" : `?created=${encodeURIComponent(slug)}`);
}

// Attach one account/property to a client.
export async function addSource(formData) {
  const supabase = getSupabaseServer();
  await adminGuard(supabase);
  const client_id = String(formData.get("client_id"));
  const source = String(formData.get("source"));
  const external_id = String(formData.get("external_id") || "").trim();
  const label = String(formData.get("label") || "").trim();
  const brand = String(formData.get("brand") || "").trim();
  const account_id = String(formData.get("account_id") || "").trim(); // CallRail account
  if (!SOURCES.includes(source) || !external_id) return back("?err=source");

  const params = { confirmed: true };
  if (label) params.label = label;
  if (brand) params.brand = brand;
  if (source === "callrail" && account_id) params.account_id = account_id;
  if (source === "google_ads") params.outside_mcc = formData.get("outside_mcc") === "on";

  const { error } = await supabase.from("client_sources")
    .upsert({ client_id, source, external_id, active: true, params },
      { onConflict: "client_id,source,external_id" });
  return back(error ? "?err=source" : "?added=1");
}

export async function setSourceActive(formData) {
  const supabase = getSupabaseServer();
  await adminGuard(supabase);
  await supabase.from("client_sources")
    .update({ active: String(formData.get("active")) === "true" })
    .eq("id", String(formData.get("id")));
  return back();
}
