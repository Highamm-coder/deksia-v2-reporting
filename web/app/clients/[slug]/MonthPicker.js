"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const fmt = (m) => {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString(undefined, { month: "short", year: "numeric" });
};

// Month selector. `months` = available 'YYYY-MM' values (desc, latest first).
// Changing it sets ?month= on the CURRENT tab path so data + tab both persist.
export default function MonthPicker({ months }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  if (!months || !months.length) return null;
  const current = params.get("month") && months.includes(params.get("month")) ? params.get("month") : months[0];

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
      <span className="muted">Month</span>
      <select
        value={current}
        onChange={(e) => {
          const sp = new URLSearchParams(params);
          sp.set("month", e.target.value);
          router.push(`${pathname}?${sp.toString()}`);
        }}
        style={{ width: "auto", margin: 0, padding: "6px 10px" }}
      >
        {months.map((m) => <option key={m} value={m}>{fmt(m)}</option>)}
      </select>
    </label>
  );
}
