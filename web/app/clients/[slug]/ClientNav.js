"use client";
import { usePathname, useSearchParams } from "next/navigation";

const TABS = [
  ["", "Overview"],
  ["paid", "Paid"],
  ["organic", "Organic"],
  ["leads", "Leads"],
  ["goals", "Goals"],
  ["settings", "Settings"],
];

// Tab bar for a client. Active tab derived from the path; the ?month= param is
// carried across tabs so a selected month sticks as you navigate.
export default function ClientNav({ slug }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const base = `/clients/${encodeURIComponent(slug)}`;
  const qs = params.get("month") ? `?month=${params.get("month")}` : "";
  const current = pathname.replace(base, "").replace(/^\//, ""); // '' | 'paid' | ...

  return (
    <nav style={{ display: "flex", gap: 4, flexWrap: "wrap", borderBottom: "1px solid var(--line)", margin: "6px 0 18px" }}>
      {TABS.map(([slugPart, label]) => {
        const active = current === slugPart;
        return (
          <a key={slugPart || "overview"} href={`${base}${slugPart ? "/" + slugPart : ""}${qs}`}
            style={{
              padding: "8px 14px", fontSize: 13, fontWeight: 600, textDecoration: "none",
              color: active ? "var(--txt)" : "var(--muted)",
              borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
              marginBottom: -1,
            }}>
            {label}
          </a>
        );
      })}
    </nav>
  );
}
