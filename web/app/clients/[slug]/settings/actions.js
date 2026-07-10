"use server";
import { getSupabaseServer } from "../../../../lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const back = (slug, q = "") => {
  revalidatePath(`/clients/${encodeURIComponent(slug)}/settings`);
  revalidatePath(`/clients/${encodeURIComponent(slug)}`);
  redirect(`/clients/${encodeURIComponent(slug)}/settings${q}#custom-metrics`);
};

const parseTerms = (vals) =>
  (vals || []).map((v) => { const [source, metric] = String(v).split("|"); return { source, metric }; })
    .filter((t) => t.source && t.metric);

// Create a computed metric (ratio of sums over additive platform metrics).
export async function addDerived(formData) {
  const slug = String(formData.get("slug"));
  const label = String(formData.get("label") || "").trim();
  const unit = ["usd", "ratio", "pct", "int"].includes(formData.get("unit")) ? formData.get("unit") : "usd";
  const numerator = parseTerms(formData.getAll("num"));
  const denominator = parseTerms(formData.getAll("den"));
  const scope = formData.get("scope") === "all" ? null : String(formData.get("client_id"));
  if (!label || !numerator.length || !denominator.length) return back(slug, "?derr=1");

  const name = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "custom";
  const supabase = getSupabaseServer();
  const { error } = await supabase.from("derived_metrics")
    .insert({ client_id: scope, name, label, unit, numerator, denominator });
  return back(slug, error ? "?derr=1" : "?dok=1");
}

// Archive / restore a computed metric.
export async function setDerivedActive(formData) {
  const slug = String(formData.get("slug"));
  const id = String(formData.get("id"));
  const active = String(formData.get("active")) === "true";
  const supabase = getSupabaseServer();
  await supabase.from("derived_metrics").update({ active, updated_at: new Date().toISOString() }).eq("id", id);
  return back(slug);
}
