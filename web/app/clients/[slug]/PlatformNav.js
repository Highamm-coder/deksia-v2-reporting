"use client";

// Sticky in-page jump nav: one link per platform section present on the page, plus
// Goals. Anchors scroll to <section id=...> below. Sits under the global header.
const LABEL = { google_ads: "Google Ads", meta: "Meta", ga4: "GA4", callrail: "CallRail", pages: "Pages", email: "Email", seo: "SEO", other: "Other" };

export default function PlatformNav({ platforms }) {
  const items = [...(platforms || []), "goals"];
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 4, background: "var(--bg)",
      borderBottom: "1px solid var(--line)", padding: "8px 0", margin: "6px 0 4px",
      display: "flex", gap: 6, flexWrap: "wrap",
    }}>
      {items.map((p) => (
        <a key={p} href={`#${p}`}
          style={{
            padding: "5px 11px", fontSize: 12, fontWeight: 600, textDecoration: "none",
            color: "var(--txt)", background: "var(--panel2)", border: "1px solid var(--line)",
            borderRadius: 999,
          }}>
          {p === "goals" ? "Goals" : (LABEL[p] || p)}
        </a>
      ))}
    </div>
  );
}
