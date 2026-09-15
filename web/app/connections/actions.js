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

// Correct a mapping's account ID or label in place. History already written under the old
// ID stays attributed to it (provenance); the probe and pull use the new ID from tonight.
export async function updateMapping(formData) {
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) back("?err=forbidden");
  const id = String(formData.get("id") || "");
  const external_id = String(formData.get("external_id") || "").trim();
  const label = String(formData.get("label") || "").trim();
  if (!id || !external_id) back("?err=missing");
  const { data: row } = await supabase.from("client_sources").select("external_id, params").eq("id", id).maybeSingle();
  if (!row) back("?err=notfound");
  const params = { ...(row.params || {}) };
  if (label) params.label = label; else delete params.label;
  if (row.external_id !== external_id) {
    params.previous_ids = [...(params.previous_ids || []), { id: row.external_id, changed_at: new Date().toISOString() }];
  }
  const { error } = await supabase.from("client_sources").update({ external_id, params, updated_at: new Date().toISOString() }).eq("id", id);
  back(error ? `?err=${encodeURIComponent(error.message.slice(0, 120))}` : "?updated=1");
}

// Probe one account now: dispatch a probe-only run scoped to it. Credentials live in
// GitHub Actions, so that is the only place a real read can happen. ~30-60 s.
export async function probeMapping(formData) {
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) back("?err=forbidden");
  const slug = String(formData.get("slug") || "");
  const source = String(formData.get("source") || "");
  const external_id = String(formData.get("external_id") || "");
  const token = (process.env.GITHUB_DISPATCH_TOKEN || "").trim();
  if (!token) back("?err=No%20GITHUB_DISPATCH_TOKEN%20in%20Vercel");
  const res = await fetch(
    "https://api.github.com/repos/Highamm-coder/deksia-v2-reporting/actions/workflows/orchestrate.yml/dispatches",
    { method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs: { probe_only: true, only_slug: slug, only_source: source, only_account: external_id } }) },
  );
  if (res.ok) back(`?probing=${encodeURIComponent(external_id)}`);
  let why = `${res.status}`;
  try { const b = await res.json(); if (b?.message) why += ` ${b.message}`; } catch { /* non-JSON */ }
  back(`?err=${encodeURIComponent(("GitHub: " + why).slice(0, 120))}`);
}
