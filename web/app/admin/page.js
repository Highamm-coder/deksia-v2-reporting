import { getSupabaseServer } from "../../lib/supabase/server";
import AppShell from "../_components/AppShell";
import { setUserBan, setBugStatus, addAdmin, removeAdmin } from "./actions";

export const dynamic = "force-dynamic";
const dt = (v) => (v ? new Date(v).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

export default async function AdminPage() {
  const supabase = getSupabaseServer();
  const [{ data: isAdmin }, { data: auth }] = await Promise.all([
    supabase.rpc("is_admin"),
    supabase.auth.getUser(),
  ]);
  const me = auth?.user?.email || "";

  if (!isAdmin) {
    return (
      <AppShell>
        <h1 style={{ fontSize: 22 }}>Admin</h1>
        <p className="muted">You&apos;re not an admin. Ask an existing admin to add you.</p>
      </AppShell>
    );
  }

  const [{ data: users }, { data: bugs }, { data: admins }, { data: creds }] = await Promise.all([
    supabase.rpc("admin_list_users"),
    supabase.from("bug_reports").select("*").order("status").order("created_at", { ascending: false }).limit(200),
    supabase.from("admins").select("*").order("email"),
    supabase.from("connector_status").select("*").order("provider"),
  ]);
  const adminSet = new Set((admins || []).map((a) => a.email));
  const openBugs = (bugs || []).filter((b) => b.status === "open");

  return (
    <AppShell>
      <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>Admin</h1>
      <p className="muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
        Users, access, and bug reports. Credential health lives on <a href="/pipeline">Pipeline health</a>.
      </p>

      <section>
        <h2>Bug reports {openBugs.length > 0 && <span className="pill stale">{openBugs.length} open</span>}</h2>
        {(bugs || []).length ? (
          <table>
            <thead><tr><th>When</th><th>Reporter</th><th style={{ whiteSpace: "normal" }}>Report</th><th>Page</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {bugs.map((b) => (
                <tr key={b.id} style={b.status === "resolved" ? { opacity: 0.55 } : undefined}>
                  <td style={{ fontSize: 12 }}>{dt(b.created_at)}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{b.reporter}</td>
                  <td style={{ whiteSpace: "normal" }}>
                    <strong>{b.title}</strong>
                    {b.detail && <span className="muted" style={{ display: "block", fontSize: 12 }}>{b.detail}</span>}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>{b.page || "—"}</td>
                  <td><span className={`pill ${b.status === "open" ? "stale" : "fresh"}`}>{b.status}</span></td>
                  <td>
                    <form action={setBugStatus} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={b.id} />
                      <input type="hidden" name="status" value={b.status === "open" ? "resolved" : "open"} />
                      <button type="submit" style={{ margin: 0, padding: "5px 10px", background: "var(--panel)", color: "var(--muted)", border: "1px solid var(--line)" }}>
                        {b.status === "open" ? "Resolve" : "Reopen"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted" style={{ fontSize: 13 }}>No bug reports yet. The 🐞 button (bottom-left, every page) files them here.</p>}
      </section>

      <section>
        <h2>Users ({users?.length ?? 0})</h2>
        <table>
          <thead><tr><th>Email</th><th>Created</th><th>Last sign-in</th><th>Status</th><th>Role</th><th></th></tr></thead>
          <tbody>
            {(users || []).map((u) => {
              const banned = u.banned_until && new Date(u.banned_until) > new Date();
              return (
                <tr key={u.id}>
                  <td>{u.email}{u.email === me && <span className="muted" style={{ fontSize: 11 }}> (you)</span>}</td>
                  <td style={{ fontSize: 12 }}>{dt(u.created_at)}</td>
                  <td style={{ fontSize: 12 }}>{dt(u.last_sign_in_at)}</td>
                  <td>{banned ? <span className="pill off_track">banned</span>
                    : u.confirmed_at ? <span className="pill fresh">active</span>
                    : <span className="pill pending">unconfirmed</span>}</td>
                  <td>{adminSet.has(u.email) ? <span className="pill achieved">admin</span> : <span className="muted" style={{ fontSize: 12 }}>member</span>}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    {u.email !== me && (
                      <form action={setUserBan} style={{ margin: 0 }}>
                        <input type="hidden" name="user_id" value={u.id} />
                        <input type="hidden" name="banned" value={banned ? "false" : "true"} />
                        <button type="submit" style={{ margin: 0, padding: "5px 10px", background: "var(--panel)",
                          color: banned ? "var(--on)" : "var(--off)", border: "1px solid var(--line)" }}>
                          {banned ? "Unban" : "Revoke access"}
                        </button>
                      </form>
                    )}
                    {adminSet.has(u.email) && u.email !== me ? (
                      <form action={removeAdmin} style={{ margin: 0 }}>
                        <input type="hidden" name="email" value={u.email} />
                        <button type="submit" style={{ margin: 0, padding: "5px 10px", background: "var(--panel)", color: "var(--muted)", border: "1px solid var(--line)" }}>
                          Remove admin
                        </button>
                      </form>
                    ) : !adminSet.has(u.email) ? (
                      <form action={addAdmin} style={{ margin: 0 }}>
                        <input type="hidden" name="email" value={u.email} />
                        <button type="submit" style={{ margin: 0, padding: "5px 10px", background: "var(--panel)", color: "var(--muted)", border: "1px solid var(--line)" }}>
                          Make admin
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Sign-ups are domain-locked to @deksia.com. “Revoke access” bans the account (reversible); it does not delete data.
        </p>
      </section>
    </AppShell>
  );
}
