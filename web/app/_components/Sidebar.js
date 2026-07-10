"use client";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { logout } from "../login/actions";

const NAV = [
  ["/", "Scoreboard", "◎"],
  ["/pipeline", "Pipeline health", "◧"],
  ["/clients", "Clients", "▤"],
  ["/account", "Account", "⚙"],
];
const RECENTS_KEY = "deksia_recent_clients";
const clientHref = (slug) => `/clients/${encodeURIComponent(slug)}`;

export default function Sidebar({ clients = [], lastSync = null }) {
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
      <div className="brand"><span aria-hidden style={{ color: "var(--accent)" }}>❖</span> Deksia</div>

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
      {NAV.map(([href, label, ic]) => (
        <a key={href} href={href} className={`navlink${isActive(href) ? " active" : ""}`}>
          <span className="ic" aria-hidden>{ic}</span>{label}
        </a>
      ))}
      <div className="grow" />
      <a href="/pipeline" className="card-cta" style={{ textDecoration: "none", color: "var(--txt)" }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Last sync</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{syncTxt} · view pipeline →</div>
      </a>
      <form action={logout} style={{ margin: 0 }}>
        <button type="submit" className="navlink" style={{ width: "100%", background: "transparent", border: 0, margin: 0, cursor: "pointer", textAlign: "left" }}>
          <span className="ic" aria-hidden>⏻</span>Sign out
        </button>
      </form>
    </aside>
  );
}
