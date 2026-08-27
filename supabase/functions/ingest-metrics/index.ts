// ingest-metrics — generic idempotent ingest into public.metrics_daily.
// verify_jwt=false; custom bearer auth against Vault `ingest_token` (write path only).
// Body: { source, rows:[{metric_name, metric_date, value, unit?, meta?, account_ext_id?, entity?, qualifier?}],
//   client_id? | client_slug? | cid? }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VALID_SOURCES = ["google_ads", "ga4", "meta", "callrail", "pages"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Constant-time-ish token check: compare SHA-256 digests so timing reveals nothing
// about the token value itself.
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
  if (tokErr || !expected) {
    console.error("token lookup failed:", tokErr?.message);
    return json({ error: "auth unavailable" }, 500);
  }
  if (!presented || !(await tokenMatches(presented, expected))) return json({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const source = String(body.source ?? "").toLowerCase();
  if (!VALID_SOURCES.includes(source)) return json({ error: `bad source '${source}'` }, 400);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) return json({ error: "no rows" }, 400);

  let clientId: string | null = body.client_id ?? null;
  if (!clientId && body.client_slug) {
    const { data } = await supabase.from("clients").select("id").eq("slug", body.client_slug).maybeSingle();
    clientId = data?.id ?? null;
  }
  if (!clientId && body.cid) {
    const cid = String(body.cid).replace(/[^0-9]/g, "");
    const { data } = await supabase.from("client_sources").select("client_id, external_id").eq("source", source);
    clientId = (data ?? []).find((r: any) => String(r.external_id).replace(/[^0-9]/g, "") === cid)?.client_id ?? null;
  }
  if (!clientId) {
    // A live ad account posting into the void is a silent data loss — record it and
    // alert (deduped daily) instead of 422-ing into a log nobody reads.
    if (body.cid) {
      try {
        await supabase.rpc("record_unmapped_post", {
          p_cid: String(body.cid), p_source: source, p_rows: rows.length,
        });
      } catch (_e) { /* never block the response on alerting */ }
    }
    return json({ error: "client not resolved (need client_id, client_slug, or known cid)" }, 422);
  }

  // provenance: stamp who wrote every row. Callers self-declare via body.writer;
  // fallbacks — cid-resolved bodies only come from the Google Ads Scripts, and
  // slug-based bodies come from the GitHub Actions runner.
  const writer = String(
    body.writer || (body.cid ? "google-ads-script" : "github-actions/run.mjs"),
  ).slice(0, 60);

  const payload = rows.map((r: any) => ({
    client_id: clientId, source,
    metric_name: String(r.metric_name),
    metric_date: String(r.metric_date),
    account_ext_id: String(r.account_ext_id ?? ""),
    entity: String(r.entity ?? ""),
    qualifier: String(r.qualifier ?? ""),
    value: r.value === null || r.value === undefined ? null : Number(r.value),
    unit: r.unit ?? null, meta: { ...(r.meta ?? {}), by: writer },
    ingested_at: new Date().toISOString(),
  }));
  const bad = payload.find((r) => !r.metric_name || !/^\d{4}-\d{2}-\d{2}$/.test(r.metric_date));
  if (bad) return json({ error: "each row needs metric_name and metric_date YYYY-MM-DD" }, 400);

  // Self-describing: platforms emit metric names we can't enumerate up front (one per
  // pixel action type). Register unseen ones with an inferred aggregation so a
  // cost-per or a rate is never summed. Cheap: one call per POST, distinct names only.
  const seen = new Map<string, string>();
  for (const r of payload) if (!seen.has(r.metric_name)) seen.set(r.metric_name, r.unit ?? "int");
  try {
    await supabase.rpc("ensure_metric_defs", {
      p_source: source,
      p_rows: [...seen].map(([metric, unit]) => ({ metric, unit })),
    });
  } catch (_e) { /* never block ingest on metadata */ }

  const { error } = await supabase.from("metrics_daily")
    .upsert(payload, { onConflict: "client_id,source,metric_name,metric_date,account_ext_id,entity,qualifier" });
  if (error) {
    console.error("upsert failed:", error.message);
    return json({ error: "upsert failed" }, 500);
  }
  return json({ ok: true, client_id: clientId, source, rows_upserted: payload.length });
});
