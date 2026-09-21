"use client";
import { useEffect, useState } from "react";

// One tab per platform, instead of every source stacked down one long page. Replaces the old
// anchor nav: the anchors only scrolled, so a client on six sources still meant six screens of
// scrolling to compare two of them.
//
// Panels are rendered by the server and passed in as children, in the same order as `tabs`;
// only the active one is mounted. A tab with no data for the month is still shown — "no Meta
// this month" is an answer, and hiding it would look like the source was never connected.
export default function SourceTabs({ tabs, children, label = "Data source" }) {
  const panels = Array.isArray(children) ? children : [children];
  const first = tabs.find((t) => t.hasData)?.key || tabs[0]?.key;
  const [active, setActive] = useState(first);

  // deep links (/clients/x#meta) and the browser back button keep working
  useEffect(() => {
    const fromHash = () => {
      const h = decodeURIComponent(window.location.hash.replace("#", ""));
      if (h && tabs.some((t) => t.key === h)) setActive(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [tabs]);

  const pick = (k) => {
    setActive(k);
    try { history.replaceState(null, "", `#${encodeURIComponent(k)}`); } catch { /* no-op */ }
  };

  const idx = Math.max(0, tabs.findIndex((t) => t.key === active));

  return (
    <>
      <div role="tablist" aria-label={label} style={{
        position: "sticky", top: 0, zIndex: 4, background: "var(--panel)",
        padding: "10px 0 8px", margin: "10px 0 0",
        display: "flex", gap: 8, flexWrap: "wrap", borderBottom: "1px solid var(--line)",
      }}>
        {tabs.map((t) => {
          const on = t.key === tabs[idx]?.key;
          return (
            <button key={t.key} type="button" role="tab" id={`tab-${t.key}`}
              aria-selected={on} aria-controls={`panel-${t.key}`} tabIndex={on ? 0 : -1}
              onClick={() => pick(t.key)}
              onKeyDown={(e) => {
                const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (!d) return;
                e.preventDefault();
                const next = tabs[(idx + d + tabs.length) % tabs.length];
                pick(next.key);
                document.getElementById(`tab-${next.key}`)?.focus();
              }}
              style={{
                margin: 0, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                borderRadius: 999, border: "1px solid var(--line)",
                background: on ? "var(--accent-soft)" : "var(--panel)",
                color: on ? "var(--accent)" : "var(--txt)",
                opacity: t.hasData === false ? 0.65 : 1,
              }}>
              {t.label}
              {t.hasData === false && <span className="muted" style={{ fontWeight: 400 }}> · none</span>}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`panel-${tabs[idx]?.key}`} aria-labelledby={`tab-${tabs[idx]?.key}`}>
        {panels[idx]}
      </div>
    </>
  );
}
