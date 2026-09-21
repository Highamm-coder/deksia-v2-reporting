"use server";
import { getSupabaseServer } from "../../../../lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const back = (slug, q = "", hash = "custom-metrics") => {
  revalidatePath(`/clients/${encodeURIComponent(slug)}/settings`);
  revalidatePath(`/clients/${encodeURIComponent(slug)}`);
  redirect(`/clients/${encodeURIComponent(slug)}/settings${q}#${hash}`);
};

const parseTerms = (vals) =>
  (vals || []).map((v) => { const [source, metric] = String(v).split("|"); return { source, metric }; })
    .filter((t) => t.source && t.metric);

// Create a computed metric (ratio of sums over additive platform metrics).
export async function addDerived(formData) {
  const slug = String(formData.get("slug"));
  { const sb = getSupabaseServer(); const { data: isAdmin } = await sb.rpc("is_admin"); if (!isAdmin) return back(slug, "?derr=forbidden"); }
  const label = String(formData.get("label") || "").trim();
  const unit = ["usd", "ratio", "pct", "int"].includes(formData.get("unit")) ? formData.get("unit") : "usd";
  const numerator = parseTerms(formData.getAll("num"));
  const denominator = parseTerms(formData.getAll("den"));
  if (!label || !numerator.length || !denominator.length) return back(slug, "?derr=1");
  const supabase = getSupabaseServer();
  const { error } = await supabase.rpc("create_derived_metric", {
    p_slug: slug, p_global: formData.get("scope") === "all", p_label: label, p_unit: unit,
    p_numerator: numerator, p_denominator: denominator,
  });
  if (error) console.error("Computed metric save failed", error);

  return back(slug, error ? "?derr=1" : "?dok=1");
}

// Archive / restore a computed metric.
export async function setDerivedActive(formData) {
  const slug = String(formData.get("slug"));
  { const sb = getSupabaseServer(); const { data: isAdmin } = await sb.rpc("is_admin"); if (!isAdmin) return back(slug, "?derr=forbidden"); }
  const id = String(formData.get("id"));
  const active = String(formData.get("active")) === "true";
  const supabase = getSupabaseServer();
  const { data, error } = await supabase.from("derived_metrics").update({ active, updated_at: new Date().toISOString() }).eq("id", id).select("id").maybeSingle();
  return back(slug, error || !data ? "?derr=save" : "");
}

// ---- Meta metric depth -------------------------------------------------------
// Meta returns ~90 action types per account, most of them aliases of each other or
// vanity engagement. Standard depth stores the conversions an account is judged on;
// full depth stores everything, for the clients who actually want it. The flag lives
// in client_sources.params so it travels with the account mapping, and the
// orchestrator reads it on every run.
export async function setMetricDepth(formData) {
  const slug = String(formData.get("slug"));
  const id = String(formData.get("source_id"));
  const depth = formData.get("depth") === "full" ? "full" : "standard";
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) return back(slug, "?depth=forbidden", "metric-depth");

  // merge, don't overwrite — params also carries confirmed/brand/note flags
  const { data: row, error: readError } = await supabase.from("client_sources").select("params").eq("id", id).maybeSingle();
  if (readError || !row) return back(slug, "?depth=failed", "metric-depth");
  const params = { ...(row?.params || {}), metric_depth: depth };
  const { data: saved, error } = await supabase.from("client_sources").update({ params }).eq("id", id).select("id").maybeSingle();
  return back(slug, error || !saved ? "?depth=failed" : `?depth=${depth}`, "metric-depth");
}

// Re-pull one client over a date range — as a backfill JOB, never a raw run. The job is
// chunked by month, Google Ads is held to 3 chunks/day by quota, and a vendor "retry later"
// defers instead of failing (the raw dispatch this replaced did none of that).
export async function repullClient(formData) {
  const slug = String(formData.get("slug"));
  const start = String(formData.get("start") || "");
  const end = String(formData.get("end") || "");
  const source = String(formData.get("source") || "");
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) return back(slug, "?repull=forbidden", "metric-depth");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return back(slug, "?repull=baddate", "metric-depth");
  const { error } = await supabase.rpc("create_backfill_job", {
    p_source: source || null, p_client_slug: slug, p_start: start, p_end: end,
    p_note: `re-pull from ${slug} settings${source ? ` (${source})` : ""}`,
  });
  if (error) return back(slug, `?repull=failed&why=${encodeURIComponent(error.message.slice(0, 160))}`, "metric-depth");
  return back(slug, "?repull=queued", "metric-depth");
}
