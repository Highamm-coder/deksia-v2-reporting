"use client";
import { useState } from "react";

// Collapsible code block with a copy button. Client component so it can use clipboard.
export default function ScriptBlock({ code, filename = "google-ads-script.js" }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--panel2)" }}>
        <button type="button" onClick={() => setOpen((o) => !o)} style={{ margin: 0, padding: "5px 10px", background: "var(--panel)", color: "var(--txt)", border: "1px solid var(--line)" }}>
          {open ? "▾ Hide script" : "▸ Show script"}
        </button>
        <span className="muted" style={{ fontSize: 12, fontFamily: "monospace" }}>{filename}</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={copy} style={{ margin: 0, padding: "5px 10px" }}>
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      {open && (
        <pre style={{ margin: 0, padding: 12, overflowX: "auto", fontSize: 12, lineHeight: 1.45, background: "var(--bg)", maxHeight: 360 }}>
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
