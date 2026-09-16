"use server";
import { getSupabaseServer } from "../../lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// Kick a probe-only orchestrator run on GitHub Actions — the credentials live
// there, so that's the only place a real connection test can happen. Admin-gated.
export async function runConnectionTest() {
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) redirect("/data?test=forbidden");

  // trim: a stray newline/space pasted into the env var yields a 401 from GitHub
  const token = (process.env.GITHUB_DISPATCH_TOKEN || "").trim();
  if (!token) redirect("/data?test=notoken");

  const res = await fetch(
    "https://api.github.com/repos/Highamm-coder/deksia-v2-reporting/actions/workflows/orchestrate.yml/dispatches",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { probe_only: true } }),
    },
  );

  revalidatePath("/data");
  if (res.ok) redirect("/data?test=started");
  // surface GitHub's own words — guessing at auth failures wastes everyone's time
  let why = `${res.status}`;
  try {
    const body = await res.json();
    if (body?.message) why += ` ${body.message}`;
  } catch { /* non-JSON body */ }
  redirect(`/data?test=failed&why=${encodeURIComponent(why.slice(0, 200))}`);
}

// ---- Backfills (platform-controlled) -------------------------------------------
// A job = source (or all) × client (or all) × date range, chunked by calendar month. The
// deksia-backfill workflow claims chunks every 2 hours; the claim function enforces the
// Google Ads daily cap and honours 429 deferrals. Admin-gated in SQL as well as here.
const toFreshness = (q) => redirect(`/data?${q}#backfills`);

export async function createBackfill(formData) {
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) toFreshness("bf=forbidden");
  const source = String(formData.get("source") || "");
  const client = String(formData.get("client_slug") || "");
  const start = String(formData.get("start") || "");
  const end = String(formData.get("end") || "");
  const note = String(formData.get("note") || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) toFreshness("bf=baddate");
  const { error } = await supabase.rpc("create_backfill_job", {
    p_source: source || null, p_client_slug: client || null, p_start: start, p_end: end, p_note: note || null,
  });
  revalidatePath("/data");
  if (error) toFreshness(`bf=failed&why=${encodeURIComponent(error.message.slice(0, 160))}`);
  toFreshness("bf=queued");
}

export async function setBackfillStatus(formData) {
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) toFreshness("bf=forbidden");
  const { error } = await supabase.rpc("set_backfill_job_status", {
    p_job: String(formData.get("job_id")), p_status: String(formData.get("status")),
  });
  revalidatePath("/data");
  toFreshness(error ? `bf=failed&why=${encodeURIComponent(error.message.slice(0, 160))}` : "bf=updated");
}

// Kick the runner now instead of waiting for the 2-hour tick.
export async function runBackfillNow() {
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) toFreshness("bf=forbidden");
  const token = (process.env.GITHUB_DISPATCH_TOKEN || "").trim();
  if (!token) toFreshness("bf=notoken");
  const res = await fetch(
    "https://api.github.com/repos/Highamm-coder/deksia-v2-reporting/actions/workflows/backfill.yml/dispatches",
    { method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main" }) },
  );
  if (res.ok) toFreshness("bf=started");
  let why = `${res.status}`;
  try { const b = await res.json(); if (b?.message) why += ` ${b.message}`; } catch { /* non-JSON */ }
  toFreshness(`bf=failed&why=${encodeURIComponent(why.slice(0, 160))}`);
}
