"use client";
import { useState } from "react";
import DataGrid from "../_components/DataGrid";

const when = (ts) => (ts ? new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const LABEL = { meta: "Meta Ads", pages: "Facebook Pages", google_ads: "Google Ads", ga4: "GA4", callrail: "CallRail", search_console: "Search Console", youtube: "YouTube" };

// Accounts a credential can see that no client owns yet.
export function UnmappedGrid({ rows, clients, isAdmin, actions }) {
  const [client, setClient] = useState("");
  const columns = [
    { key: "source", label: "Source", filter: "select", filterLabel: (v) => LABEL[v] || v, render: (r) => LABEL[r.source] || r.source, sort: (r) => r.source, width: 130 },
    { key: "name", label: "Account", render: (r) => <>{r.name || <span className="muted">—</span>}{r.extra?.business ? <span className="muted"> · {r.extra.business}</span> : null}{r.extra?.account ? <span className="muted"> · {r.extra.account}</span> : null}</>, sort: (r) => r.name || "", wrap: true },
    { key: "external_id", label: "ID", small: true, className: "muted", sort: (r) => r.external_id },
    { key: "provider", label: "Credential", filter: "select", hidden: true, sort: (r) => r.provider },
    { key: "last_seen", label: "Seen", small: true, className: "muted", render: (r) => when(r.last_seen), sort: (r) => r.last_seen },
  ];
  const clientPicker = () => (
    <select name="client_id" required value={client} onChange={(e) => setClient(e.target.value)} className="grid-select" style={{ maxWidth: 220 }}>
      <option value="" disabled>map to client…</option>
      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
  return (
    <DataGrid id="connections-unmapped" title="Visible, not mapped" rows={rows} rowId={(r) => `${r.source}|${r.external_id}`}
      columns={columns} search={(r) => `${r.name || ""} ${r.external_id} ${r.extra?.business || ""} ${r.extra?.account || ""}`}
      initialSort={{ key: "source", dir: "asc" }} pageSize={20} dense
      empty="Everything this credential can see is either mapped or ignored."
      bulk={isAdmin ? [
        { label: "Map to client", action: actions.mapDiscoveredBulk, fields: clientPicker },
        { label: "Ignore", action: actions.ignoreDiscovered, tone: "danger", confirm: "Hide the selected accounts from this list? You can bring them back from Ignored." },
      ] : []}
      rowMenu={isAdmin ? (r) => [
        { label: "Ignore", action: actions.ignoreDiscovered, fields: { ids: `${r.source}|${r.external_id}` }, tone: "danger" },
      ] : null}
    />
  );
}

export function IgnoredGrid({ rows, isAdmin, actions }) {
  const columns = [
    { key: "source", label: "Source", filter: "select", filterLabel: (v) => LABEL[v] || v, render: (r) => LABEL[r.source] || r.source, sort: (r) => r.source, width: 130 },
    { key: "name", label: "Account", render: (r) => r.name || <span className="muted">—</span>, sort: (r) => r.name || "", wrap: true },
    { key: "external_id", label: "ID", small: true, className: "muted" },
    { key: "ignored_at", label: "Ignored", small: true, className: "muted", render: (r) => `${when(r.ignored_at)}${r.ignored_by ? ` · ${r.ignored_by.split("@")[0]}` : ""}`, sort: (r) => r.ignored_at },
  ];
  return (
    <DataGrid id="connections-ignored" title="Ignored" rows={rows} rowId={(r) => `${r.source}|${r.external_id}`} columns={columns}
      search={(r) => `${r.name || ""} ${r.external_id}`} pageSize={20} dense empty="Nothing ignored."
      bulk={isAdmin ? [{ label: "Bring back", action: actions.unignoreDiscovered }] : []} />
  );
}

// Every account attached to a client, across all credentials.
export function MappedGrid({ rows, probes, statusRows, isAdmin, actions, highlight, initialEdit }) {
  const [editing, setEditing] = useState(initialEdit || null);
  const norm = (v) => String(v || "").replace(/\D/g, "") || String(v || "");
  const probeFor = (m) => probes.find((p) => p.source === m.source && p.client_slug === m.clients?.slug && norm(p.external_id) === norm(m.external_id));
  const probeState = (m) => { if (!m.active) return "inactive"; const p = probeFor(m); return !p ? "not probed" : p.reachable ? "ok" : "refused"; };
  const columns = [
    { key: "client", label: "Client", render: (r) => <a href={`/clients/${encodeURIComponent(r.clients?.slug || "")}`} style={{ color: "inherit", textDecoration: "none", fontWeight: 600 }}>{r.clients?.name || "—"}</a>, sort: (r) => r.clients?.name || "", filter: "select", filterValue: (r) => r.clients?.name || "—" },
    { key: "source", label: "Source", filter: "select", filterLabel: (v) => LABEL[v] || v, render: (r) => LABEL[r.source] || r.source, sort: (r) => r.source, width: 130 },
    { key: "account", label: "Account", wrap: true, small: true, sort: (r) => r.params?.label || r.external_id,
      render: (r) => editing === r.id ? (
        <form action={actions.updateMapping} style={{ margin: 0, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input type="hidden" name="id" value={r.id} />
          <input name="label" defaultValue={r.params?.label || ""} placeholder="label" className="grid-search" style={{ width: 150 }} />
          <input name="external_id" defaultValue={r.external_id} required className="grid-search" style={{ width: 150, fontFamily: "ui-monospace, monospace" }} />
          <button type="submit" className="grid-btn solid">Save</button>
          <button type="button" className="grid-btn" onClick={() => setEditing(null)}>Cancel</button>
        </form>
      ) : (
        <>{r.params?.label ? <>{r.params.label} <span className="muted">· {r.external_id}</span></> : r.external_id}
          {r.params?.metric_depth === "full" && <span className="muted"> · full depth</span>}
          {r.params?.previous_ids?.length > 0 && <div className="muted" style={{ fontSize: 11 }}>was {r.params.previous_ids.map((p) => p.id).join(", ")}</div>}</>
      ) },
    { key: "probe", label: "Access", filter: "select", filterValue: (r) => probeState(r), sort: (r) => probeState(r), width: 110,
      render: (r) => { const st = probeState(r); const p = probeFor(r);
        const dot = (c) => <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 99, background: c, marginRight: 6, verticalAlign: "middle" }} />;
        return st === "inactive" ? <span className="muted">inactive</span> : st === "not probed" ? <span className="muted">not probed yet</span>
          : <span title={p?.detail}>{dot(st === "ok" ? "var(--on)" : "var(--off)")}{st === "ok" ? "reads" : "refused"}</span>; } },
    { key: "detail", label: "Provider says", wrap: true, small: true, className: "muted", hidden: true, render: (r) => probeFor(r)?.detail || "—" },
    { key: "fresh", label: "Freshness", filter: "select", width: 110, filterValue: (r) => statusRows.find((s) => s.slug === r.clients?.slug && s.source === r.source)?.sync_status || "—",
      render: (r) => { const s = statusRows.find((x) => x.slug === r.clients?.slug && x.source === r.source); return s ? <span className={`pill ${s.sync_status}`}>{s.sync_status?.replace("_", " ")}</span> : <span className="muted">—</span>; } },
    { key: "probed_at", label: "Last probe", small: true, className: "muted", hidden: true, render: (r) => when(probeFor(r)?.probed_at), sort: (r) => probeFor(r)?.probed_at },
  ];
  const styled = rows.map((r) => ({ ...r, _style: { ...(r.active ? {} : { opacity: 0.55 }), ...(String(highlight || "") === String(r.id) ? { outline: "2px solid var(--txt)", outlineOffset: -2 } : {}) } }));
  return (
    <DataGrid id="connections-mapped" title="Mapped accounts" rows={styled} rowId={(r) => r.id} columns={columns}
      search={(r) => `${r.clients?.name || ""} ${r.params?.label || ""} ${r.external_id} ${r.source}`} initialSort={{ key: "client", dir: "asc" }} pageSize={25} dense
      empty="No accounts mapped yet."
      bulk={isAdmin ? [
        { label: "Deactivate", action: actions.setMappingsActive, fields: () => <input type="hidden" name="active" value="false" />, tone: "danger", confirm: "Deactivate the selected mappings? History is kept; they stop being pulled." },
        { label: "Reactivate", action: actions.setMappingsActive, fields: () => <input type="hidden" name="active" value="true" /> },
      ] : []}
      rowMenu={isAdmin ? (r) => [
        ...(r.active ? [{ label: "Try again (probe now)", action: actions.probeMapping, fields: { slug: r.clients?.slug || "", source: r.source, external_id: r.external_id } }] : []),
        { label: "Edit label / ID", href: "#", onClick: null, action: null, fields: null, __edit: r.id },
        { label: "Re-pull this year", href: `/data?client=${encodeURIComponent(r.clients?.slug || "")}&source=${r.source}&start=${new Date().getUTCFullYear()}-01-01#backfills` },
        { label: r.active ? "Deactivate" : "Reactivate", action: actions.setMappingActive, fields: { id: r.id, active: r.active ? "false" : "true" }, tone: r.active ? "danger" : undefined },
      ].map((m) => m.__edit ? { label: m.label, href: `?mapping=${m.__edit}&edit=1#row-${m.__edit}` } : m) : null}
    />
  );
}
