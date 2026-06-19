// ingest-metrics — generic idempotent ingest into public.metrics_daily.
// Deployed with verify_jwt=false; custom bearer auth: Authorization: Bearer <ingest_token>.
// Body: { source, rows:[{metric_name, metric_date, value, unit?, meta?}],
//         client_id? | client_slug? | cid? }  (one resolver required)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VALID_SOURCES = ["google_ads", "ga4", "meta", "callrail", "pages"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const auth = req.headers.get("Authorization") ?? "";
  const presented = auth.replace(/^Bearer\s+/i, "").trim();
  const { data: expected, error: tokErr } = await supabase.rpc("get_ingest_token");
  if (tokErr) return json({ error: "token lookup failed", detail: tokErr.message }, 500);
  if (!presented || presented !== expected) return json({ error: "unauthorized" }, 401);

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
  if (!clientId) return json({ error: "client not resolved (need client_id, client_slug, or known cid)" }, 422);

  const payload = rows.map((r: any) => ({
    client_id: clientId, source,
    metric_name: String(r.metric_name),
    metric_date: String(r.metric_date),
    account_ext_id: String(r.account_ext_id ?? ""),
    entity: String(r.entity ?? ""),
    qualifier: String(r.qualifier ?? ""),
    value: r.value === null || r.value === undefined ? null : Number(r.value),
    unit: r.unit ?? null, meta: r.meta ?? {},
    ingested_at: new Date().toISOString(),
  }));
  const bad = payload.find((r) => !r.metric_name || !/^\d{4}-\d{2}-\d{2}$/.test(r.metric_date));
  if (bad) return json({ error: "each row needs metric_name and metric_date YYYY-MM-DD" }, 400);

  const { error } = await supabase.from("metrics_daily")
    .upsert(payload, { onConflict: "client_id,source,metric_name,metric_date,account_ext_id,entity,qualifier" });
  if (error) return json({ error: "upsert failed", detail: error.message }, 500);
  return json({ ok: true, client_id: clientId, source, rows_upserted: payload.length });
});
