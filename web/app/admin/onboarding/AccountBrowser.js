"use client";
import { useMemo, useState } from "react";
import ScriptBlock from "../../_components/ScriptBlock";
import { generateGoogleAdsScript } from "../../../lib/googleAdsScript";
import { setSourceActive } from "./actions";

const SRC_LABEL = {
  google_ads: "Google Ads", meta: "Meta ad account", ga4: "GA4 property",
  callrail: "CallRail company", pages: "Facebook Page",
};

// Searchable, collapsed-by-default account browser — one row per client until you
// open it. Keeps a 28-client / 100-account inventory scannable.
export default function AccountBrowser({ clients, sources, probes }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState({});
  const [onlyIssues, setOnlyIssues] = useState(false);

  const bySlug = useMemo(() => {
    const m = {};
    (probes || []).forEach((p) => { m[`${p.client_slug}|${p.source}|${p.external_id}`] = p; });
    return m;
  }, [probes]);

  const rows = useMemo(() => {
    const byClient = {};
    (sources || []).forEach((s) => { (byClient[s.client_id] = byClient[s.client_id] || []).push(s); });
    const needle = q.trim().toLowerCase();
    return (clients || []).map((c) => {
      const list = byClient[c.id] || [];
      const probeOf = (s) => bySlug[`${c.slug}|${s.source}|${String(s.external_id)}`];
      const issues = list.filter((s) => s.active && probeOf(s) && !probeOf(s).reachable).length;
      const match = !needle
        || (c.name || "").toLowerCase().includes(needle)
        || c.slug.toLowerCase().includes(needle)
        || list.some((s) => String(s.external_id).toLowerCase().includes(needle)
          || String(s.params?.label || "").toLowerCase().includes(needle)
          || s.source.includes(needle));
      return { c, list, issues, probeOf, match };
    }).filter((r) => r.list.length && r.match && (!onlyIssues || r.issues > 0));
  }, [clients, sources, bySlug, q, onlyIssues]);

  return (
    <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "0 0 10px" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client, account name or ID…"
          style={{ margin: 0, maxWidth: 320 }} />
        <label style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
          <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)}
            style={{ width: "auto", margin: 0 }} /> only accounts needing attention
        </label>
        <span className="muted" style={{ fontSize: 12 }}>{rows.length} client{rows.length === 1 ? "" : "s"}</span>
        <button type="button" onClick={() => setOpen(rows.every((r) => open[r.c.id]) ? {} : Object.fromEntries(rows.map((r) => [r.c.id, true])))}
          style={{ margin: 0, marginLeft: "auto", padding: "6px 12px", background: "var(--panel)", color: "var(--muted)", border: "1px solid var(--line)" }}>
          {rows.every((r) => open[r.c.id]) && rows.length ? "Collapse all" : "Expand all"}
        </button>
      </div>

      {rows.map(({ c, list, issues, probeOf }) => {
        const isOpen = !!open[c.id];
        const gads = list.filter((s) => s.source === "google_ads");
        return (
          <div key={c.id} style={{ border: "1px solid var(--line)", borderRadius: 12, marginBottom: 8, overflow: "hidden" }}>
            <button type="button" onClick={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))}
              style={{ margin: 0, width: "100%", textAlign: "left", background: "var(--panel)", color: "var(--txt)",
                border: 0, padding: "11px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <span className="muted" style={{ fontSize: 11 }}>{isOpen ? "▾" : "▸"}</span>
              <span style={{ fontWeight: 700 }}>{c.name || c.slug}</span>
              <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                {list.length} account{list.length === 1 ? "" : "s"}
                {gads.length ? ` · ${gads.length} Google Ads` : ""}
              </span>
              {issues > 0 && <span className="pill off_track" style={{ marginLeft: "auto" }}>{issues} no data</span>}
            </button>

            {isOpen && (
              <div style={{ padding: "0 14px 14px", background: "var(--panel2)" }}>
                <table>
                  <thead><tr><th>Platform</th><th>Account</th><th>ID</th><th>Connection</th><th></th></tr></thead>
                  <tbody>
                    {list.map((s) => {
                      const pr = probeOf(s);
                      return (
                        <tr key={s.id} style={!s.active ? { opacity: 0.55 } : undefined}>
                          <td className="muted">{SRC_LABEL[s.source] || s.source}</td>
                          <td>{s.params?.label || "—"}{s.params?.brand ? <span className="muted" style={{ fontSize: 11 }}> · {s.params.brand}</span> : null}</td>
                          <td className="muted" style={{ fontSize: 12 }}>{s.external_id}</td>
                          <td>{!s.active ? <span className="pill pending">inactive</span>
                            : pr ? <span className={`pill ${pr.reachable ? "fresh" : "off_track"}`} title={pr.detail || ""}>
                                {pr.reachable ? "connected" : "no data"}</span>
                            : <span className="pill pending">not tested</span>}</td>
                          <td>
                            <form action={setSourceActive} style={{ margin: 0 }}>
                              <input type="hidden" name="id" value={s.id} />
                              <input type="hidden" name="active" value={s.active ? "false" : "true"} />
                              <button type="submit" style={{ margin: 0, padding: "5px 10px", background: "var(--panel)", color: "var(--muted)", border: "1px solid var(--line)" }}>
                                {s.active ? "Deactivate" : "Activate"}
                              </button>
                            </form>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {gads.map((s) => (
                  <details key={s.id} style={{ marginTop: 8 }}>
                    <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                      Script — {s.params?.label || s.external_id}
                      <span className="muted" style={{ fontWeight: 400 }}> · {s.external_id}
                        {s.params?.outside_mcc ? " · outside MCC (install this)" : " · in MCC (covered nightly)"}</span>
                    </summary>
                    <ScriptBlock
                      code={generateGoogleAdsScript(c.slug, c.name, String(s.external_id), s.params?.label || "")}
                      filename={`google-ads-${c.slug}-${String(s.external_id).replace(/\D/g, "")}.js`}
                    />
                  </details>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {!rows.length && <p className="muted" style={{ fontSize: 13 }}>No accounts match.</p>}
    </>
  );
}
