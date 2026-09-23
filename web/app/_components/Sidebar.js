"use client";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { logout } from "../login/actions";

const NAV = [
  ["/", "Scoreboard", "◎"],
  ["/clients", "Clients", "▤"],
  ["/account", "Account", "⚙"],
];
const RECENTS_KEY = "deksia_recent_clients";
const clientHref = (slug) => `/clients/${encodeURIComponent(slug)}`;

export default function Sidebar({ clients = [], lastSync = null, email = null, credWarning = null, integrity = null, isAdmin = false, shellFailed = false }) {
  // display identity from the email local part: "matthew" → "Matthew"
  const nm = email ? email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : null;
  const initials = nm ? nm.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase() : "?";
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [recents, setRecents] = useState([]);

  // record visits to client pages → recents (this browser)
  useEffect(() => {
    try {
      const m = pathname.match(/^\/clients\/([^/]+)/);
      let list = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
      if (m) {
        const slug = decodeURIComponent(m[1]);
        if (clients.some((c) => c.slug === slug)) {
          list = [slug, ...list.filter((s) => s !== slug)].slice(0, 5);
          localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
        }
      }
      setRecents(list.filter((s) => clients.some((c) => c.slug === s)));
    } catch {}
  }, [pathname, clients]);

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return clients
      .filter((c) => c.slug.toLowerCase().includes(needle) || (c.name || "").toLowerCase().includes(needle))
      .slice(0, 8);
  }, [q, clients]);

  const go = (slug) => { setQ(""); setSel(0); router.push(clientHref(slug)); };
  const isActive = (href) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const syncTxt = lastSync
    ? new Date(lastSync).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "—";

  return (
    <aside className="sidebar">
      <div className="brand">
        <a href="/" style={{ display: "block", lineHeight: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/deksia-logo.svg" alt="DEKSIA" style={{ height: 20, width: "auto", display: "block" }} />
        </a>
      </div>

      <div className="side-search">
        <input
          type="search" placeholder="Find a client…" aria-label="Find a client"
          value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === "Enter" && hits[sel]) go(hits[sel].slug);
            else if (e.key === "Escape") setQ("");
          }}
        />
        {q && (
          <div className="hits">
            {hits.length ? hits.map((c, i) => (
              <a key={c.slug} href={clientHref(c.slug)} className={`hit${i === sel ? " sel" : ""}`}
                onClick={(e) => { e.preventDefault(); go(c.slug); }}>
                {c.slug}{c.name && c.name !== c.slug ? <span className="muted"> · {c.name}</span> : null}
              </a>
            )) : <span className="hit muted">No match</span>}
          </div>
        )}
        {!q && recents.length > 0 && (
          <div className="hits">
            <span className="sub">Recent</span>
            {recents.map((s) => <a key={s} href={clientHref(s)} className="hit">{s}</a>)}
          </div>
        )}
      </div>

      <div style={{ height: 8 }} />
      {[...NAV, ...(isAdmin ? [["/data", "Data health", "◧"], ["/connections", "Connections", "⛓"], ["/admin", "Admin", "◆"]] : [])].map(([href, label, ic]) => (
        <a key={href} href={href} className={`navlink${isActive(href) ? " active" : ""}`}>
          <span className="ic" aria-hidden>{ic}</span>{label}
        </a>
      ))}
      <div className="grow" />
      {credWarning && (
        <a href="/data" style={{ textDecoration: "none", display: "block", background: "rgba(169,118,0,.10)",
          border: "1px solid rgba(169,118,0,.35)", borderRadius: 12, padding: "10px 12px", marginBottom: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: "var(--risk)" }}>⚠ {credWarning}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>view credentials →</div>
        </a>
      )}
      <a href="/data" className="card-cta" style={{ textDecoration: "none", color: "var(--txt)" }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Last sync</div>
        {shellFailed ? (
          // the sync time, credential warning, integrity status and client list all failed to load —
          // say so rather than showing their absence as if it were the real state
          <div style={{ fontSize: 12, marginTop: 4, fontWeight: 600, color: "var(--risk)" }}>
            ⚠ Status didn’t load — sync, credentials and integrity unknown. Reload to try again.
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{syncTxt} · view data health →</div>
        )}
        {integrity && (
          <div style={{ fontSize: 12, marginTop: 6, fontWeight: 600,
            color: integrity.status === "ok" ? "var(--on)" : integrity.status === "attention" ? "var(--risk)" : "var(--off)" }}>
            {integrity.status === "ok" ? "✓ data verified — no gaps" : integrity.status === "attention" ? "⚠ gaps need attention" : "✕ integrity issues"}
          </div>
        )}
      </a>
      <div className="userbox">
        <span className="av" aria-hidden>{initials}</span>
        <span className="who">
          {nm && <span className="nm" style={{ display: "block" }}>{nm}</span>}
          {email && <span className="em" style={{ display: "block" }}>{email}</span>}
        </span>
        <form action={logout} style={{ margin: 0 }}>
          <button type="submit" title="Sign out" style={{ margin: 0, padding: "4px 8px", background: "transparent",
            color: "var(--muted)", border: 0, cursor: "pointer", fontSize: 15 }}>⏻</button>
        </form>
      </div>
    </aside>
  );
}
