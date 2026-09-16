// V2 Reporting — live dashboard (Supabase Edge Function)
// Server-renders the goal scoreboard, connector health, and pipeline freshness
// straight from the warehouse views. Live on every load; no client-side keys.
//
// Auth: token gate. Set the DASHBOARD_TOKEN secret, then open
//   https://<project>.supabase.co/functions/v1/dashboard?key=<token>
// Deployed with verify_jwt=false so it's browser-openable; the token is the gate.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = Deno.env.get("DASHBOARD_TOKEN");
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const num = (v: unknown) =>
  v == null || v === "" ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 1 });
const pct = (v: unknown) => (v == null ? "—" : Math.round(Number(v) * 100) + "%");

const GOAL_C: Record<string, string> = {
  achieved: "#2bd47b", on_track: "#54a3ff", at_risk: "#f4b740", off_track: "#ff6b5e", pending: "#6b7894",
};
const HEALTH_C: Record<string, string> = {
  flowing: "#2bd47b", degraded: "#f4b740", idle: "#54a3ff", not_flowing: "#6b7894", offline: "#ff6b5e",
};

function shell(body: string, status = 200): Response {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="300">
<title>V2 Reporting — Live</title><style>
:root{--bg:#0f1420;--panel:#171e2c;--ink:#eaf0fa;--muted:#8b9abc;--line:#283449}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.45}
.wrap{max-width:1000px;margin:0 auto;padding:24px 18px 60px}
.eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:700}
h1{font-size:22px;margin:5px 0 2px;font-weight:800}
.sub{font-size:12.5px;color:var(--muted)}
h2{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:700;margin:26px 0 12px}
.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}
@media(max-width:640px){.kpis{grid-template-columns:repeat(3,1fr)}}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 10px;text-align:center}
.kpi .n{font-size:22px;font-weight:800}.kpi .l{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:12.5px;display:flex;align-items:center;gap:8px}
.dot{width:8px;height:8px;border-radius:50%}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:var(--panel)}
table{border-collapse:collapse;width:100%;font-size:13px;min-width:560px}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700}
td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}tr:last-child td{border-bottom:0}
.pill{font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:6px;color:#0f1420}
.bar{height:6px;border-radius:99px;background:#283449;overflow:hidden;min-width:60px}.bar i{display:block;height:100%}
.foot{margin-top:26px;font-size:11px;color:#6b7894;text-align:center}
.center{max-width:460px;margin:12vh auto;text-align:center;padding:0 20px}
code{background:#283449;padding:1px 6px;border-radius:5px;font-size:12px}
</style></head><body>${body}</body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function setupPage() {
  return shell(`<div class="center"><div class="eyebrow">V2 Reporting</div>
  <h1>🔒 Dashboard not yet secured</h1>
  <p class="sub">Set a <code>DASHBOARD_TOKEN</code> secret on this function, then open it with
  <code>?key=&lt;token&gt;</code>. No data is shown until a token is configured.</p></div>`, 200);
}
function lockedPage() {
  return shell(`<div class="center"><div class="eyebrow">V2 Reporting</div>
  <h1>🔒 Access denied</h1><p class="sub">Append <code>?key=&lt;token&gt;</code> with the correct token.</p></div>`, 401);
}

function kpis(g: any[]) {
  const by = (s: string) => g.filter((r) => r.status === s).length;
  const cells = [
    ["Total", g.length, "#eaf0fa"], ["Achieved", by("achieved"), GOAL_C.achieved],
    ["On track", by("on_track"), GOAL_C.on_track], ["At risk", by("at_risk"), GOAL_C.at_risk],
    ["Off track", by("off_track"), GOAL_C.off_track], ["Pending", by("pending"), GOAL_C.pending],
  ];
  return `<div class="kpis">${cells.map(([l, n, c]) =>
    `<div class="kpi"><div class="n" style="color:${c}">${n}</div><div class="l">${l}</div></div>`).join("")}</div>`;
}

function healthRow(h: any[]) {
  const latest = new Map<string, any>();
  for (const r of h) { const k = (r.source ?? "").toLowerCase(); if (!latest.has(k)) latest.set(k, r); }
  return `<div class="chips">${[...latest.values()].map((r) =>
    `<span class="chip"><span class="dot" style="background:${HEALTH_C[r.status] ?? "#6b7894"}"></span>
     <b>${esc(r.source)}</b> · ${esc(r.status)}</span>`).join("")}</div>`;
}

function goalsTable(rows: any[]) {
  if (!rows.length) return `<div class="sub">No goals.</div>`;
  return `<div class="scroll"><table><thead><tr>
    <th>Client</th><th>Metric</th><th class="r">Target</th><th class="r">Current</th>
    <th>Progress</th><th>Status</th><th class="r">Days left</th></tr></thead><tbody>${rows.map((r) => {
    const p = r.pct_to_target == null ? 0 : Math.max(0, Math.min(1, Number(r.pct_to_target)));
    const c = GOAL_C[r.status] ?? "#6b7894";
    return `<tr><td>${esc(r.slug ?? r.name)}</td><td>${esc(r.metric_name)}</td>
      <td class="r">${num(r.target_value)}</td><td class="r">${num(r.current_value)}</td>
      <td><div class="bar"><i style="width:${Math.round(p * 100)}%;background:${c}"></i></div>
        <span class="sub">${pct(r.pct_to_target)}</span></td>
      <td><span class="pill" style="background:${c}">${esc(r.status)}</span></td>
      <td class="r">${r.days_remaining ?? "—"}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const provided = url.searchParams.get("key") ?? req.headers.get("x-dashboard-token");
  if (!TOKEN) return setupPage();
  if (provided !== TOKEN) return lockedPage();
  try {
    const [score, health] = await Promise.all([
      sb.from("v_goal_scoreboard").select("*"),
      sb.from("connector_health").select("*").order("checked_at", { ascending: false }),
    ]);
    if (score.error) throw score.error;
    const goals = score.data ?? [];
    const order = { off_track: 0, at_risk: 1, on_track: 2, pending: 3, achieved: 4 } as Record<string, number>;
    const sorted = [...goals].sort((a, b) =>
      (Number(b.needs_attention) - Number(a.needs_attention)) ||
      ((order[a.status] ?? 9) - (order[b.status] ?? 9)) ||
      String(a.slug).localeCompare(String(b.slug)));
    const attention = sorted.filter((r) => r.needs_attention);
    const now = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
    const body = `<div class="wrap">
      <div class="eyebrow">Deksia · V2 Reporting</div>
      <h1>Goal Scoreboard</h1>
      <div class="sub">Live from Supabase · ${esc(now)} · auto-refreshes every 5 min</div>
      <h2>Pulse</h2>${kpis(goals)}
      <h2>Connector health</h2>${healthRow(health.data ?? [])}
      <h2>⚠️ Needs attention (${attention.length})</h2>${goalsTable(attention)}
      <h2>All goals (${sorted.length})</h2>${goalsTable(sorted)}
      <div class="foot">Source: v_goal_scoreboard + connector_health · project ykxauddrsnuwkvimkdhw</div>
    </div>`;
    return shell(body);
  } catch (e) {
    return shell(`<div class="center"><h1>Error</h1><p class="sub">${esc(String((e as Error).message ?? e))}</p></div>`, 500);
  }
});
