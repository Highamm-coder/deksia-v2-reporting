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

  const token = process.env.GITHUB_DISPATCH_TOKEN;
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
  redirect(res.ok ? "/pipeline?test=started" : "/pipeline?test=failed");
}
