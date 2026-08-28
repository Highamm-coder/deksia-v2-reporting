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
  if (!error) {
    // register under source='derived' so goals can target it (FK) and it appears in
    // the goal editor's metric picker. agg='avg' = level semantics in the tracker.
    await supabase.from("metric_definitions").upsert({
      source: "derived", metric_name: name, unit,
      direction_default: unit === "usd" ? "decrease" : "increase",
      agg: "avg",
      description: `${label} — Deksia-computed formula`,
      provenance: "Deksia-computed (ratio of platform sums) — not a platform-reported number.",
    }, { onConflict: "source,metric_name" });
  }
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
  const { data: row } = await supabase.from("client_sources").select("params").eq("id", id).maybeSingle();
  const params = { ...(row?.params || {}), metric_depth: depth };
  const { error } = await supabase.from("client_sources").update({ params }).eq("id", id);
  return back(slug, error ? "?depth=failed" : `?depth=${depth}`, "metric-depth");
}

// Re-pull one client over a date range. Changing depth only affects days that get
// pulled again, so switching a client to full is inert until this runs. Targeted by
// slug so we don't re-pull 13 accounts to backfill one.
export async function repullClient(formData) {
  const slug = String(formData.get("slug"));
  const start = String(formData.get("start") || "");
  const end = String(formData.get("end") || "");
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) return back(slug, "?repull=forbidden", "metric-depth");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return back(slug, "?repull=baddate", "metric-depth");

  const token = (process.env.GITHUB_DISPATCH_TOKEN || "").trim();
  if (!token) return back(slug, "?repull=notoken", "metric-depth");

  const res = await fetch(
    "https://api.github.com/repos/Highamm-coder/deksia-v2-reporting/actions/workflows/orchestrate.yml/dispatches",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { run_start: start, run_end: end, only_slug: slug } }),
    },
  );
  if (res.ok) return back(slug, "?repull=started", "metric-depth");
  let why = `${res.status}`;
  try { const b = await res.json(); if (b?.message) why += ` ${b.message}`; } catch { /* non-JSON */ }
  return back(slug, `?repull=failed&why=${encodeURIComponent(why.slice(0, 200))}`, "metric-depth");
}
