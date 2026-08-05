import { getSupabaseServer } from "../../../../lib/supabase/server";
import { addGoal, updateGoal, setGoalActive, addObjective, setObjectiveActive, logManualMetric } from "./actions";

export const dynamic = "force-dynamic";
const d10 = (d) => (d ? String(d).slice(0, 10) : "");
const num = (v, dp = 2) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: dp }));

const MSG = { add: "Couldn't add the goal — check the metric, target, and due date.", edit: "Couldn't save — target and due date are required.",
  obj: "Couldn't add the objective — a title is required.", log: "Couldn't log — needs a metric, a date, and a number.",
  added: "Goal added.", saved: "Goal saved.", objadded: "Objective added — it's at the top of the client page.",
  logged: "Logged. It shows under \"Tracked manually\" on the dashboard." };

export default async function GoalsEditor({ params, searchParams }) {
  const slug = decodeURIComponent(params.slug);
  const supabase = getSupabaseServer();
  const [{ data: client }, { data: goals }, { data: defs }, { data: objectives }, { data: manualRows }] = await Promise.all([
    supabase.from("clients").select("id, slug, name").eq("slug", slug).maybeSingle(),
    supabase.from("goals").select("*").order("active", { ascending: false }).order("source").order("metric_name"),
    supabase.from("metric_definitions").select("source, metric_name, direction_default").order("source").order("metric_name"),
    supabase.from("client_objectives").select("*").order("kind").order("position").order("created_at"),
    supabase.from("metrics_daily").select("client_id, metric_name, metric_date, value, unit, meta").eq("source", "manual").order("metric_date", { ascending: false }).limit(500),
  ]);
  if (!client) return <p>Client not found.</p>;
  const myGoals = (goals || []).filter((g) => g.client_id === client.id);
  const active = myGoals.filter((g) => g.active);
  const archived = myGoals.filter((g) => !g.active);
  const myObjectives = (objectives || []).filter((o) => o.client_id === client.id);
  const manualDefs = (defs || []).filter((d) => d.source === "manual");
  const myManual = (manualRows || []).filter((r) => r.client_id === client.id).slice(0, 20);
  const msg = searchParams?.error ? MSG[searchParams.error]
    : (searchParams?.added ? MSG.added : searchParams?.saved ? MSG.saved
      : searchParams?.objadded ? MSG.objadded : searchParams?.logged ? MSG.logged : null);
  const isErr = !!searchParams?.error;

  const GoalRow = ({ g }) => (
    <tr>
      <td className="muted">{g.source}</td>
      <td>{g.metric_name}</td>
      <td>
        <form action={updateGoal} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: 0 }}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="goal_id" value={g.id} />
          <input name="target_value" type="number" step="any" defaultValue={g.target_value} required title="target" style={{ width: 90, margin: 0 }} />
          <select name="direction" defaultValue={g.direction} title="direction" style={{ width: "auto", margin: 0 }}>
            <option value="increase">↑ increase</option>
            <option value="decrease">↓ decrease</option>
          </select>
          <input name="start_date" type="date" defaultValue={d10(g.start_date)} title="start" style={{ width: "auto", margin: 0 }} />
          <input name="due_date" type="date" defaultValue={d10(g.due_date)} required title="due" style={{ width: "auto", margin: 0 }} />
          <input name="notes" defaultValue={g.notes || ""} placeholder="notes" style={{ width: 140, margin: 0 }} />
          <button type="submit" style={{ margin: 0, padding: "6px 12px" }}>Save</button>
        </form>
      </td>
      <td className="muted">{num(g.current_value)} · {g.status?.replace("_", " ")}</td>
      <td>
        <form action={setGoalActive} style={{ margin: 0 }}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="goal_id" value={g.id} />
          <input type="hidden" name="active" value={g.active ? "false" : "true"} />
          <button type="submit" style={{ margin: 0, padding: "6px 10px", background: "var(--panel2)", color: "var(--muted)", border: "1px solid var(--line)" }}>
            {g.active ? "Archive" : "Restore"}
          </button>
        </form>
      </td>
    </tr>
  );

  return (
    <>
      <h2 style={{ color: "var(--accent)" }}>Manage goals — {client.name || client.slug}</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        <a href={`/clients/${encodeURIComponent(slug)}`}>← Back to dashboard</a> · new/edited goals are scored on the next daily run.
      </p>
      {msg ? <div style={{ margin: "8px 0", color: isErr ? "var(--off)" : "var(--on)", fontSize: 13 }}>{msg}</div> : null}

      <h2>Objectives <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>· shown at the top of the client page</span></h2>
      {myObjectives.length > 0 && (
        <table>
          <thead><tr><th>Kind</th><th style={{ whiteSpace: "normal" }}>Objective</th><th>Linked goal</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {myObjectives.map((o) => {
              const lg = o.goal_id ? myGoals.find((g) => g.id === o.goal_id) : null;
              return (
                <tr key={o.id} style={!o.active ? { opacity: 0.55 } : undefined}>
                  <td><span className={`pill ${o.kind === "business" ? "achieved" : "idle"}`}>{o.kind}</span></td>
                  <td style={{ whiteSpace: "normal" }}>{o.title}{o.detail && <span className="muted" style={{ display: "block", fontSize: 12 }}>{o.detail}</span>}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{lg ? `${lg.source} · ${lg.metric_name}` : "—"}</td>
                  <td>{lg ? <span className={`pill ${lg.status}`}>{lg.status?.replace("_", " ")}</span> : <span className="muted">—</span>}</td>
                  <td>
                    <form action={setObjectiveActive} style={{ margin: 0 }}>
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="id" value={o.id} />
                      <input type="hidden" name="active" value={o.active ? "false" : "true"} />
                      <button type="submit" style={{ margin: 0, padding: "6px 10px", background: "var(--panel2)", color: "var(--muted)", border: "1px solid var(--line)" }}>
                        {o.active ? "Archive" : "Restore"}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <form action={addObjective} className="card" style={{ maxWidth: "none", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 10 }}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="client_id" value={client.id} />
        <label style={{ margin: 0 }}>Kind
          <select name="kind" defaultValue="business" style={{ width: "auto" }}>
            <option value="business">Business goal</option>
            <option value="engagement">Engagement goal</option>
          </select>
        </label>
        <label style={{ margin: 0, flex: 1, minWidth: 220 }}>Title<input name="title" required placeholder='e.g. "Sell 12 homes in 2026"' /></label>
        <label style={{ margin: 0, flex: 1, minWidth: 200 }}>Detail<input name="detail" placeholder="optional context" /></label>
        <label style={{ margin: 0 }}>Track with goal
          <select name="goal_id" defaultValue="" style={{ minWidth: 180 }}>
            <option value="">— none (narrative only) —</option>
            {active.map((g) => <option key={g.id} value={g.id}>{g.source} · {g.metric_name} ≥/≤ {num(g.target_value)}</option>)}
          </select>
        </label>
        <button type="submit" style={{ margin: 0 }}>Add objective</button>
      </form>

      <h2>Log an outcome <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>· manual metrics (homes sold, deals closed…)</span></h2>
      <form action={logManualMetric} className="card" style={{ maxWidth: "none", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="client_id" value={client.id} />
        <label style={{ margin: 0 }}>Metric
          <select name="metric_existing" defaultValue="" style={{ minWidth: 170 }}>
            <option value="">— new metric →</option>
            {manualDefs.map((d) => <option key={d.metric_name} value={d.metric_name}>{d.metric_name.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label style={{ margin: 0 }}>New metric name<input name="metric_new" placeholder='e.g. "Homes sold"' style={{ width: 160 }} /></label>
        <label style={{ margin: 0 }}>Unit
          <select name="unit" defaultValue="int" style={{ width: "auto" }}>
            <option value="int">count</option>
            <option value="usd">$</option>
            <option value="pct">%</option>
          </select>
        </label>
        <label style={{ margin: 0 }}>Date<input name="metric_date" type="date" required style={{ width: "auto" }} /></label>
        <label style={{ margin: 0 }}>Value<input name="value" type="number" step="any" required placeholder="e.g. 1" style={{ width: 90 }} /></label>
        <label style={{ margin: 0, flex: 1, minWidth: 160 }}>Note<input name="note" placeholder="optional — e.g. address, deal name" /></label>
        <button type="submit" style={{ margin: 0 }}>Log it</button>
      </form>
      <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
        One value per metric per day — logging the same day again overwrites it (corrections). Every entry records who logged it.
        Manual metrics appear under “Tracked manually” on the dashboard and can be used in goals and computed formulas.
      </p>
      {myManual.length > 0 && (
        <>
          <h2>Recent manual entries</h2>
          <table>
            <thead><tr><th>Date</th><th>Metric</th><th className="num">Value</th><th>Note</th><th>Logged by</th></tr></thead>
            <tbody>
              {myManual.map((r, i) => (
                <tr key={i}>
                  <td>{r.metric_date}</td>
                  <td>{r.metric_name.replace(/_/g, " ")}</td>
                  <td className="num">{num(r.value)}</td>
                  <td className="muted" style={{ whiteSpace: "normal", fontSize: 12 }}>{r.meta?.note || ""}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{r.meta?.by || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Add a goal</h2>
      <form action={addGoal} className="card" style={{ maxWidth: "none", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="client_id" value={client.id} />
        <label style={{ margin: 0 }}>Metric
          <select name="source_metric" required defaultValue="" style={{ minWidth: 220 }}>
            <option value="" disabled>Select source · metric…</option>
            {Object.entries((defs || []).reduce((acc, d) => { (acc[d.source] = acc[d.source] || []).push(d); return acc; }, {})).map(([src, list]) => (
              <optgroup key={src} label={src}>
                {list.map((d) => <option key={`${src}|${d.metric_name}`} value={`${src}|${d.metric_name}`}>{src} · {d.metric_name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label style={{ margin: 0 }}>Target<input name="target_value" type="number" step="any" required placeholder="e.g. 50" style={{ width: 100 }} /></label>
        <label style={{ margin: 0 }}>Direction
          <select name="direction" defaultValue="increase" style={{ width: "auto" }}>
            <option value="increase">↑ increase</option>
            <option value="decrease">↓ decrease (cost/rank)</option>
          </select>
        </label>
        <label style={{ margin: 0 }}>Start<input name="start_date" type="date" style={{ width: "auto" }} /></label>
        <label style={{ margin: 0 }}>Due<input name="due_date" type="date" required style={{ width: "auto" }} /></label>
        <label style={{ margin: 0 }}>Baseline<input name="baseline_value" type="number" step="any" placeholder="opt." style={{ width: 90 }} /></label>
        <button type="submit" style={{ margin: 0 }}>Add goal</button>
      </form>

      <h2>Active goals ({active.length})</h2>
      {active.length ? (
        <table>
          <thead><tr><th>Source</th><th>Metric</th><th>Target · direction · window · notes</th><th>Current</th><th></th></tr></thead>
          <tbody>{active.map((g) => <GoalRow key={g.id} g={g} />)}</tbody>
        </table>
      ) : <p className="muted">No active goals. Add one above.</p>}

      {archived.length > 0 && (
        <>
          <h2>Archived ({archived.length})</h2>
          <table>
            <thead><tr><th>Source</th><th>Metric</th><th>Target · direction · window · notes</th><th>Current</th><th></th></tr></thead>
            <tbody>{archived.map((g) => <GoalRow key={g.id} g={g} />)}</tbody>
          </table>
        </>
      )}
    </>
  );
}
