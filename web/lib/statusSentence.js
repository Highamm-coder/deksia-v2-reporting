// One plain-language sentence per client × source, for account managers who need to know
// "wait or report?" without reading probes. Inputs are a v_client_source_status row.
// Mapping agreed with the review panel (2026-09-15); order matters — first match wins.
export function statusSentence(r) {
  if (!r) return { text: "Connection verified tonight.", tone: "muted" };
  const d = (v) => (v ? new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null);
  if (r.reachable === false)
    return { text: `Provider refused access on ${d(r.probed_at) || "the last check"} — Deksia is on it.`, tone: "off" };
  if (r.sync_status === "idle" && !r.last_metric_date)
    return { text: "Connected — nothing to report yet (no spend or traffic).", tone: "muted" };
  if (r.sync_status === "idle")
    return { text: `Nothing to report since ${r.last_metric_date} — connection healthy.`, tone: "muted" };
  if (r.sync_status === "fresh")
    return { text: `Data through ${r.last_metric_date}.`, tone: "on" };
  if (r.deferred_until)
    return { text: `Waiting on ${r.source_label || r.source} quota until ${new Date(r.deferred_until).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" })}.`, tone: "risk" };
  if (r.credential_status === "expired")
    return { text: "Provider credential expired — Deksia is on it.", tone: "off" };
  if (r.sync_status === "stale")
    return { text: `Data behind since ${r.last_metric_date || "—"} — Deksia is on it.`, tone: "risk" };
  if (r.sync_status === "no_data")
    return { text: "Connected, but nothing has landed yet — checked again tonight.", tone: "muted" };
  return { text: "Connection verified tonight.", tone: "muted" };
}
export const toneColor = { on: "var(--on)", off: "var(--off)", risk: "var(--risk)", muted: "var(--muted)" };
