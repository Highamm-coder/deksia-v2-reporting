// dashboard-data — returns the two dashboard zones as JSON.
// verify_jwt=false; bearer-gated with the Vault `dashboard_token` (READ-ONLY path,
// separate from the ingest write token). CORS-enabled for the interim static dashboard;
// retire this endpoint once the Next.js console fully replaces dashboard.html.
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

async function tokenMatches(presented: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(presented)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const av = new Uint8Array(a), bv = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const presented = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const { data: expected, error: tErr } = await supabase.rpc("get_dashboard_token");
  if (tErr || !expected) {
    console.error("token lookup failed:", tErr?.message);
    return json({ error: "auth unavailable" }, 500);
  }
  if (!presented || !(await tokenMatches(presented, expected))) return json({ error: "unauthorized" }, 401);

  const [pipeline, goals] = await Promise.all([
    supabase.from("v_pipeline_health").select("*").order("slug").order("source"),
    supabase.from("v_goal_scoreboard").select("*").order("slug").order("metric_name"),
  ]);
  if (pipeline.error || goals.error) {
    console.error("query failed:", pipeline.error?.message || goals.error?.message);
    return json({ error: "query failed" }, 500);
  }

  return json({ generated_at: new Date().toISOString(), pipeline: pipeline.data, goals: goals.data });
});
