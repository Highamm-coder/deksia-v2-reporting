// dashboard-data — returns the two dashboard zones as JSON.
// Deployed with verify_jwt=false; bearer-gated with the Vault ingest_token. CORS-enabled.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const presented = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const { data: expected, error: tErr } = await supabase.rpc("get_ingest_token");
  if (tErr) return json({ error: "token lookup failed" }, 500);
  if (!presented || presented !== expected) return json({ error: "unauthorized" }, 401);

  const [pipeline, goals] = await Promise.all([
    supabase.from("v_pipeline_health").select("*").order("slug").order("source"),
    supabase.from("v_goal_scoreboard").select("*").order("slug").order("metric_name"),
  ]);
  if (pipeline.error) return json({ error: pipeline.error.message }, 500);
  if (goals.error) return json({ error: goals.error.message }, 500);

  return json({ generated_at: new Date().toISOString(), pipeline: pipeline.data, goals: goals.data });
});
