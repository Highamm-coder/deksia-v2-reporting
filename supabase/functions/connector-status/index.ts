// connector-status — pipeline self-reports credential health (e.g. Meta token
// expiry from Facebook's debug_token). verify_jwt=false; bearer auth against the
// Vault ingest_token, same as ingest-metrics.
// Body: { rows: [{ provider, status, detail?, expires_at? }] }
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
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return json({ error: "no rows" }, 400);

  const payload = rows.map((r: any) => ({
    provider: String(r.provider).slice(0, 40),
    status: String(r.status ?? "unknown").slice(0, 20),
    detail: r.detail == null ? null : String(r.detail).slice(0, 300),
    expires_at: r.expires_at ?? null,
    checked_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from("connector_status").upsert(payload, { onConflict: "provider" });
  if (error) return json({ error: "upsert failed" }, 500);
  return json({ ok: true, updated: payload.length });
});
