"use server";
import { getSupabaseServer } from "../../../../lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const goalsPath = (slug) => `/clients/${encodeURIComponent(slug)}/goals`;

function done(slug, q = "") {
  revalidatePath(goalsPath(slug));
  revalidatePath(`/clients/${encodeURIComponent(slug)}`); // dashboard goals section
  redirect(`${goalsPath(slug)}${q}`);
}

// Create a goal for this client. source+metric come combined as "source|metric".
export async function addGoal(formData) {
  const slug = String(formData.get("slug"));
  const client_id = String(formData.get("client_id"));
  const [source, metric_name] = String(formData.get("source_metric") || "").split("|");
  const target_value = Number(formData.get("target_value"));
  const due_date = String(formData.get("due_date") || "");
  const start_date = String(formData.get("start_date") || "");
  const direction = String(formData.get("direction") || "increase");
  const baselineRaw = formData.get("baseline_value");
  const notes = String(formData.get("notes") || "").trim();

  if (!source || !metric_name || !Number.isFinite(target_value) || !due_date) return done(slug, "?error=add");

  const row = { client_id, source, metric_name, target_value, direction, due_date };
  if (start_date) row.start_date = start_date;
  if (baselineRaw !== null && String(baselineRaw).trim() !== "") row.baseline_value = Number(baselineRaw);
  if (notes) row.notes = notes;

  const supabase = getSupabaseServer();
  const { error } = await supabase.from("goals").insert(row);
  return done(slug, error ? "?error=add" : "?added=1");
}

// Edit an existing goal's targetable fields.
export async function updateGoal(formData) {
  const slug = String(formData.get("slug"));
  const id = String(formData.get("goal_id"));
  const target_value = Number(formData.get("target_value"));
  const due_date = String(formData.get("due_date") || "");
  if (!Number.isFinite(target_value) || !due_date) return done(slug, "?error=edit");

  const patch = {
    target_value,
    due_date,
    direction: String(formData.get("direction") || "increase"),
    start_date: String(formData.get("start_date") || "") || undefined,
    notes: String(formData.get("notes") || "").trim() || null,
    updated_at: new Date().toISOString(),
  };
  const supabase = getSupabaseServer();
  const { error } = await supabase.from("goals").update(patch).eq("id", id);
  return done(slug, error ? "?error=edit" : "?saved=1");
}

// Archive (active=false) or restore (active=true). Keeps goal_progress history intact.
export async function setGoalActive(formData) {
  const slug = String(formData.get("slug"));
  const id = String(formData.get("goal_id"));
  const active = String(formData.get("active")) === "true";
  const supabase = getSupabaseServer();
  await supabase.from("goals").update({ active, updated_at: new Date().toISOString() }).eq("id", id);
  return done(slug);
}

// ---- Objectives: the business goal + engagement goals shown atop the client page ----
export async function addObjective(formData) {
  const slug = String(formData.get("slug"));
  const client_id = String(formData.get("client_id"));
  const kind = formData.get("kind") === "business" ? "business" : "engagement";
  const title = String(formData.get("title") || "").trim();
  const detail = String(formData.get("detail") || "").trim() || null;
  const goal_id = String(formData.get("goal_id") || "") || null;
  if (!title) return done(slug, "?error=obj");
  const supabase = getSupabaseServer();
  const { error } = await supabase.from("client_objectives").insert({ client_id, kind, title, detail, goal_id });
  return done(slug, error ? "?error=obj" : "?objadded=1");
}

export async function setObjectiveActive(formData) {
  const slug = String(formData.get("slug"));
  const id = String(formData.get("id"));
  const active = String(formData.get("active")) === "true";
  const supabase = getSupabaseServer();
  await supabase.from("client_objectives").update({ active, updated_at: new Date().toISOString() }).eq("id", id);
  return done(slug);
}

// ---- Manual metrics: hand-logged outcomes (homes sold, deals closed, ...) ----
// One value per metric per day; re-logging the same day overwrites (correction).
// Provenance: meta.by records who logged it.
export async function logManualMetric(formData) {
  const slug = String(formData.get("slug"));
  const client_id = String(formData.get("client_id"));
  const existing = String(formData.get("metric_existing") || "");
  const newName = String(formData.get("metric_new") || "").trim();
  const unit = ["int", "usd", "pct"].includes(formData.get("unit")) ? formData.get("unit") : "int";
  const metric_date = String(formData.get("metric_date") || "");
  const value = Number(formData.get("value"));
  const note = String(formData.get("note") || "").trim();

  const metric_name = existing || newName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
  if (!metric_name || !/^\d{4}-\d{2}-\d{2}$/.test(metric_date) || !Number.isFinite(value)) return done(slug, "?error=log");

  const supabase = getSupabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  const by = auth?.user?.email || "console";

  if (!existing) {
    // register the definition so goals / formulas / views can use it
    const { error: defErr } = await supabase.from("metric_definitions").upsert({
      source: "manual", metric_name, unit, agg: "sum", direction_default: "increase",
      description: `${newName} — tracked manually`,
      provenance: "Hand-entered in the console; each entry records who logged it.",
    }, { onConflict: "source,metric_name" });
    if (defErr) return done(slug, "?error=log");
  }

  const { error } = await supabase.from("metrics_daily").upsert({
    client_id, source: "manual", metric_name, metric_date,
    account_ext_id: "", entity: "", qualifier: "",
    value, unit,
    meta: { by, ...(note ? { note } : {}) },
    ingested_at: new Date().toISOString(),
  }, { onConflict: "client_id,source,metric_name,metric_date,account_ext_id,entity,qualifier" });
  return done(slug, error ? "?error=log" : "?logged=1");
}
