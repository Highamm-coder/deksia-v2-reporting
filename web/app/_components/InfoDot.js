"use client";
import { useEffect, useRef, useState } from "react";

// ⓘ provenance affordance: unobtrusive dot; click → popover explaining exactly where
// the numbers in this section come from. Keeps lineage one click away, never inline.
export default function InfoDot({ title = "Where this data comes from", lines = [] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", (e) => e.key === "Escape" && setOpen(false));
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <span ref={ref} style={{ position: "relative", display: "inline-block", marginLeft: 6 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        title={title}
        style={{ margin: 0, padding: 0, width: 18, height: 18, lineHeight: "16px", fontSize: 11,
          borderRadius: "50%", background: "transparent", color: "var(--muted)",
          border: "1px solid var(--line)", cursor: "pointer", verticalAlign: "middle" }}>
        i
      </button>
      {open && (
        <div role="dialog" aria-label={title}
          style={{ position: "absolute", zIndex: 30, top: 24, left: 0, width: 340, maxWidth: "80vw",
            background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12,
            padding: "12px 14px", boxShadow: "0 10px 30px rgba(35,45,90,.16)",
            fontSize: 12, lineHeight: 1.5, textTransform: "none", letterSpacing: 0,
            color: "var(--txt)", fontWeight: 400, whiteSpace: "normal", textAlign: "left" }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
          {lines.filter(Boolean).map(([k, v], i) => (
            <div key={i} style={{ marginBottom: 5 }}>
              <span className="muted" style={{ textTransform: "uppercase", fontSize: 10, letterSpacing: ".05em" }}>{k}</span><br />
              {v}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
