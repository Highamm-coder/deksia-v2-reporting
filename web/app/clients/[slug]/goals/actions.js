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
