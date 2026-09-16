// gads-queue — work queue for the Google Ads Scripts backfill.
// verify_jwt=false; bearer auth against the Vault ingest_token (same as ingest-metrics).
//   POST { action: "claim",    cid, limit? }        -> { days: ["YYYY-MM-DD", …] }
//   POST { action: "complete", cid, day, rows, ok? } -> { ok: true }
// The script loops: claim → post each day via ingest-metrics → complete. Its hourly
// schedule drains the backlog with no human involvement.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const presented = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const { data: expected, error: tokErr } = await supabase.rpc("get_ingest_token");
  if (tokErr || !expected) return json({ error: "auth unavailable" }, 500);
  if (!presented || !(await tokenMatches(presented, expected))) return json({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const cid = String(body.cid ?? "").replace(/[^0-9]/g, "");
  if (!cid) return json({ error: "cid required" }, 400);

  if (body.action === "claim") {
    const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 60);
    const { data, error } = await supabase.rpc("gads_claim", { p_cid: cid, p_limit: limit });
    if (error) return json({ error: error.message }, 500);
    // rpc returns [{ gads_claim: "2026-07-31" }, …] or plain strings depending on shape
    const days = (data ?? []).map((r: any) => (typeof r === "string" ? r : r.gads_claim ?? r.day)).filter(Boolean);
    return json({ days });
  }

  if (body.action === "complete") {
    const day = String(body.day ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "day must be YYYY-MM-DD" }, 400);
    const { error } = await supabase.rpc("gads_complete", {
      p_cid: cid, p_day: day, p_rows: Number(body.rows) || 0,
      p_ok: body.ok !== false, p_note: body.note ? String(body.note).slice(0, 200) : null,
    });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "action must be claim | complete" }, 400);
});
