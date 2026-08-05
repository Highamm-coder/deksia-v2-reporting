"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { reportBug } from "../actions/bugs";

// Floating bug reporter, bottom-right on every authenticated page. Captures the
// current path automatically; submissions land in bug_reports (admin page) and
// email out via the notify trigger.
export default function BugButton() {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const pathname = usePathname();

  return (
    <div style={{ position: "fixed", right: 18, bottom: 18, zIndex: 60 }}>
      {open && (
        <div style={{ position: "absolute", bottom: 46, right: 0, width: 320, background: "#fff",
          border: "1px solid var(--line)", borderRadius: 14, padding: "14px 16px",
          boxShadow: "0 18px 50px rgba(15,20,40,.18)" }}>
          {sent ? (
            <>
              <div style={{ fontWeight: 700, fontSize: 13 }}>✓ Thanks — logged and sent.</div>
              <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
                It&apos;s in the admin queue and Matt&apos;s inbox.
              </p>
            </>
          ) : (
            <form onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const fd = new FormData(e.currentTarget);
              fd.set("page", pathname || "");
              try { await reportBug(fd); setSent(true); } finally { setBusy(false); }
            }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Report a bug</div>
              <label style={{ fontSize: 12 }}>What&apos;s wrong?
                <input name="title" required maxLength={120} placeholder="Short summary" style={{ marginTop: 4 }} />
              </label>
              <label style={{ display: "block", marginTop: 8, fontSize: 12 }}>Details
                <textarea name="detail" rows={3} maxLength={2000}
                  placeholder="What did you expect vs what happened? Which client/month?"
                  style={{ width: "100%", marginTop: 4, font: "inherit", border: "1px solid var(--line)",
                    borderRadius: 7, padding: "8px 10px", resize: "vertical" }} />
              </label>
              <p className="muted" style={{ fontSize: 11, margin: "6px 0 0" }}>Page captured automatically: {pathname}</p>
              <button type="submit" disabled={busy} style={{ width: "100%", marginTop: 10, padding: "9px 12px" }}>
                {busy ? "Sending…" : "Send report"}
              </button>
            </form>
          )}
        </div>
      )}
      <button type="button" onClick={() => { setOpen((o) => !o); if (sent) setSent(false); }}
        title="Report a bug"
        style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 13px",
          borderRadius: 999, fontSize: 12.5, boxShadow: "0 8px 24px rgba(15,20,40,.22)" }}>
        🐞 {open ? "Close" : "Report a bug"}
      </button>
    </div>
  );
}
