"use client";
import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Spinner from "../../_components/Spinner";

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
  // Changing the month re-renders the whole page on the server, which on a big client is a
  // visible pause. Without this the select snaps to the new month and nothing else happens
  // for a beat, which reads as "it ignored me".
  const [pending, startTransition] = useTransition();
  // the month being loaded, which is NOT `current` — the URL only catches up when the
  // transition finishes, so labelling the spinner from `current` announces the old month
  const [target, setTarget] = useState(null);
  if (!months || !months.length) return null;
  const current = params.get("month") && months.includes(params.get("month")) ? params.get("month") : months[0];

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
      <span className="muted">Month</span>
      <select
        value={current}
        onChange={(e) => {
          const month = e.target.value;
          setTarget(month);
          startTransition(() => {
            const sp = new URLSearchParams(params);
            sp.set("month", month);
            router.push(`${pathname}?${sp.toString()}`);
          });
        }}
        aria-busy={pending}
        style={{ width: "auto", margin: 0, padding: "6px 10px" }}
      >
        {months.map((m) => <option key={m} value={m}>{fmt(m)}</option>)}
      </select>
      {pending && <Spinner label={`Loading ${fmt(target || current)}`} />}
    </label>
  );
}
