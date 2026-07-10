"use client";
import { usePathname } from "next/navigation";
import { logout } from "../login/actions";

const NAV = [
  ["/", "Overview", "◧"],
  ["/clients", "Clients", "▤"],
  ["/account", "Account", "⚙"],
];

export default function Sidebar() {
  const pathname = usePathname() || "/";
  const isActive = (href) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <aside className="sidebar">
      <div className="brand"><span aria-hidden style={{ color: "var(--accent)" }}>❖</span> Deksia</div>
      {NAV.map(([href, label, ic]) => (
        <a key={href} href={href} className={`navlink${isActive(href) ? " active" : ""}`}>
          <span className="ic" aria-hidden>{ic}</span>{label}
        </a>
      ))}
      <div className="grow" />
      <div className="card-cta">
        <div style={{ fontWeight: 700, fontSize: 13 }}>Marketing reporting</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>All client data, refreshed daily.</div>
      </div>
      <form action={logout} style={{ margin: 0 }}>
        <button type="submit" className="navlink" style={{ width: "100%", background: "transparent", border: 0, margin: 0, cursor: "pointer", textAlign: "left" }}>
          <span className="ic" aria-hidden>⏻</span>Sign out
        </button>
      </form>
    </aside>
  );
}
