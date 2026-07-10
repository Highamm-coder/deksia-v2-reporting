import { getSupabaseServer } from "../../../../lib/supabase/server";
import { addGoal, updateGoal, setGoalActive } from "./actions";

export const dynamic = "force-dynamic";
const d10 = (d) => (d ? String(d).slice(0, 10) : "");
const num = (v, dp = 2) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: dp }));

const MSG = { add: "Couldn't add the goal — check the metric, target, and due date.", edit: "Couldn't save — target and due date are required.",
  added: "Goal added.", saved: "Goal saved." };

export default async function GoalsEditor({ params, searchParams }) {
  const slug = decodeURIComponent(params.slug);
  const supabase = getSupabaseServer();
  const [{ data: client }, { data: goals }, { data: defs }] = await Promise.all([
    supabase.from("clients").select("id, slug, name").eq("slug", slug).maybeSingle(),
    supabase.from("goals").select("*").order("active", { ascending: false }).order("source").order("metric_name"),
    supabase.from("metric_definitions").select("source, metric_name, direction_default").order("source").order("metric_name"),
  ]);
  if (!client) return <p>Client not found.</p>;
  const myGoals = (goals || []).filter((g) => g.client_id === client.id);
  const active = myGoals.filter((g) => g.active);
  const archived = myGoals.filter((g) => !g.active);
  const msg = searchParams?.error ? MSG[searchParams.error] : (searchParams?.added ? MSG.added : searchParams?.saved ? MSG.saved : null);
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
