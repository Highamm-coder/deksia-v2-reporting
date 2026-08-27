"use server";
import { getSupabaseServer } from "../../lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// Kick a probe-only orchestrator run on GitHub Actions — the credentials live
// there, so that's the only place a real connection test can happen. Admin-gated.
export async function runConnectionTest() {
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) redirect("/pipeline?test=forbidden");

  // trim: a stray newline/space pasted into the env var yields a 401 from GitHub
  const token = (process.env.GITHUB_DISPATCH_TOKEN || "").trim();
  if (!token) redirect("/pipeline?test=notoken");

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

  revalidatePath("/pipeline");
  if (res.ok) redirect("/pipeline?test=started");
  // surface GitHub's own words — guessing at auth failures wastes everyone's time
  let why = `${res.status}`;
  try {
    const body = await res.json();
    if (body?.message) why += ` ${body.message}`;
  } catch { /* non-JSON body */ }
  redirect(`/pipeline?test=failed&why=${encodeURIComponent(why.slice(0, 200))}`);
}

// Queue a Google Ads backfill range. The Ads Scripts drain it on their own hourly
// schedule — no date-range pasting, no per-month runs.
export async function enqueueGadsBackfill(formData) {
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) redirect("/pipeline?bf=forbidden");
  const start = String(formData.get("start") || "");
  const end = String(formData.get("end") || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) redirect("/pipeline?bf=baddate");
  const { data, error } = await supabase.rpc("gads_enqueue", { p_start: start, p_end: end, p_cid: null });
  revalidatePath("/pipeline");
  redirect(error ? "/pipeline?bf=failed" : `/pipeline?bf=${encodeURIComponent(String(data ?? 0))}`);
}
