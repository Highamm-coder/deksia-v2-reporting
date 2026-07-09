import { logout } from "../login/actions";

export default function Header() {
  return (
    <header>
      <h1>Deksia <span className="muted">Console</span></h1>
      <nav>
        <a href="/">Overview</a>
        <a href="/clients">Clients</a>
        <a href="/account">Account</a>
      </nav>
      <span className="spacer" />
      <form action={logout}>
        <button style={{ margin: 0, background: "transparent", color: "var(--muted)", padding: "4px 8px" }}>
          Sign out
        </button>
      </form>
    </header>
  );
}
