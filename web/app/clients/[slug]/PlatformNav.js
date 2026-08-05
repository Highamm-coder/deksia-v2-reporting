"use client";

// Sticky in-page jump nav: one link per platform section present on the page, plus
// Goals. Anchors scroll to <section id=...> below. Sits under the global header.
const LABEL = { google_ads: "Google Ads", meta: "Meta", ga4: "GA4", callrail: "CallRail", pages: "Pages", manual: "Manual", email: "Email", seo: "SEO", other: "Other" };

export default function PlatformNav({ platforms }) {
  const items = [...(platforms || []), "goals"];
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 4, background: "var(--panel)",
      padding: "10px 0 8px", margin: "4px 0 0",
      display: "flex", gap: 8, flexWrap: "wrap",
    }}>
      {items.map((p, i) => (
        <a key={p} href={`#${p}`}
          style={{
            padding: "6px 14px", fontSize: 13, fontWeight: 600, textDecoration: "none",
            color: i === 0 ? "var(--accent)" : "var(--txt)",
            background: i === 0 ? "var(--accent-soft)" : "var(--panel)",
            border: "1px solid var(--line)", borderRadius: 999,
          }}>
          {p === "goals" ? "Goals" : (LABEL[p] || p)}
        </a>
      ))}
    </div>
  );
}
