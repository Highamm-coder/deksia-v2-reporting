#!/usr/bin/env node
// Weekly health check — the data doctor, run on a schedule.
//
// The daily run's integrity sentinel works per SOURCE: it re-pulls a day that NO client has.
// This works per CLIENT MAPPING, which is where the quiet problems live — one client missing a
// day the others have, an account mapped months ago that has never returned a row, access that
// was revoked, a credential about to expire, a backfill that gave up, rollups that stopped.
//
// It applies only the safe fixes, all of them in the database (see doctor_fix):
//   • a gap  -> queue a RE-PULL from the platform (never a guess, never a fill)
//   • a mapping that never pulled but probes reachable -> queue a first pull
//   • stale rollups -> refresh them
// Anything needing a human (credentials, access, a wrong id) is reported, never touched.
// Queued jobs drain through the existing backfill runner (every 2 h, ≤3 Google Ads chunks/day),
// so this script does not dispatch anything itself.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Optional: DRY_RUN=1 (report, change nothing),
// MAX_JOBS (default 8), WINDOW_DAYS (default 30).
// Exit code 1 only when a HIGH-severity item needs a human (broken credential, lost access), so
// the workflow goes red and GitHub notifies. Warnings are emailed and leave the run green.

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}
const DRY_RUN = process.env.DRY_RUN === "1";
const MAX_JOBS = Number(process.env.MAX_JOBS || 8);
const RUN_URL = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`Supabase ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Findings that a human has to resolve — nothing in the database can fix these.
const NEEDS_HUMAN = new Set(["unreachable", "credential_bad", "credential_expiring", "chunk_exhausted", "db_size"]);
const line = (f) => {
  const who = [f.slug, f.source].filter(Boolean).join(" / ") || f.source || "platform";
  return `• ${who}: ${f.detail}${f.fix && f.fix !== "none" ? `\n    → ${f.fix}` : ""}`;
};

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const actor = `weekly health check ${today}`;
  console.log(`Data doctor — ${actor}${DRY_RUN ? " (dry run)" : ""}`);

  const out = await sb("rpc/doctor_fix", {
    method: "POST",
    body: JSON.stringify({ p_actor: actor, p_dry_run: DRY_RUN, p_max_jobs: MAX_JOBS }),
  });
  const findings = out?.findings || [];
  const actions = out?.actions || [];

  const bySeverity = (s) => findings.filter((f) => f.severity === s);
  const human = findings.filter((f) => NEEDS_HUMAN.has(f.kind) || (f.kind === "never_pulled" && f.reachable !== true));
  // Only a HIGH-severity item fails the run. A credential expiring in six weeks is worth an
  // email, not a red run every Monday until someone rotates it.
  const urgent = human.filter((f) => f.severity === "high");
  const watching = findings.filter((f) => ["verified_empty", "gap_in_flight", "chunk_deferred", "discovered_unmapped"].includes(f.kind));

  // ---- console report (the workflow log) ----
  console.log(`\nFindings: ${findings.length} — ${bySeverity("high").length} high, ${bySeverity("warn").length} warn, ${bySeverity("info").length} info`);
  console.log(`Actions:  ${actions.length}${DRY_RUN ? " (none applied — dry run)" : ""}`);
  if (actions.length) {
    console.log("\nFixed automatically:");
    for (const a of actions) {
      const who = [a.slug, a.source].filter(Boolean).join(" / ") || a.source || "rollups";
      const range = a.from_date ? ` ${a.from_date}..${a.to_date}` : "";
      console.log(`  • ${a.action.replace(/_/g, " ")} — ${who}${range}${a.clients ? ` (${a.clients.join(", ")})` : ""}`);
    }
  }
  if (human.length) {
    console.log("\nNeeds a human:");
    for (const f of human) console.log("  " + line(f).replace(/\n {4}/g, "\n     "));
  }
  if (watching.length) {
    const counts = watching.reduce((m, f) => ((m[f.kind] = (m[f.kind] || 0) + 1), m), {});
    console.log("\nWatching: " + Object.entries(counts).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", "));
  }
  if (!findings.length) console.log("\nNothing to report — every mapping complete, every connection healthy.");

  // ---- one email, only when it says something ----
  try {
    if (actions.length || human.length) {
      // A dry run must never claim anything was fixed — it only says what it would have done.
      const verb = DRY_RUN ? "would fix" : "fixed automatically";
      const tag = DRY_RUN ? " [dry run — nothing changed]" : "";
      const subject = urgent.length
        ? `🔴 Weekly health check: ${urgent.length} item(s) need you now` + (actions.length ? `, ${actions.length} ${verb}` : "") + tag
        : human.length
          ? `🟠 Weekly health check: ${actions.length} ${verb}, ${human.length} to keep an eye on${tag}`
          : `🟢 Weekly health check: ${actions.length} item(s) ${verb}${tag}`;
      const body =
        `Data doctor, ${today}.${DRY_RUN ? " DRY RUN — nothing was changed; this is what it would have done." : ""}\n\n` +
        (actions.length
          ? `${DRY_RUN ? `WOULD FIX (${actions.length})` : `FIXED AUTOMATICALLY (${actions.length})`}\nRe-pulled from the platform — nothing was edited or filled in.\n` +
            actions.map((a) => {
              const who = [a.slug, a.source].filter(Boolean).join(" / ") || a.source || "rollups";
              return `• ${a.action.replace(/_/g, " ")} — ${who}${a.from_date ? ` ${a.from_date}..${a.to_date}` : ""}`;
            }).join("\n") + "\n\n"
          : "") +
        (human.length ? `NEEDS YOU (${human.length})\n` + human.map(line).join("\n") + "\n\n" : "") +
        (watching.length ? `WATCHING\n` + Object.entries(watching.reduce((m, f) => ((m[f.kind] = (m[f.kind] || 0) + 1), m), {}))
          .map(([k, n]) => `• ${n} ${k.replace(/_/g, " ")}`).join("\n") + "\n\n" : "") +
        `Queued re-pulls drain through the backfill runner (every 2 hours; Google Ads is capped at 3 chunks a day).\n` +
        `Console: https://reporting.deksia.com/data\n` +
        (RUN_URL ? `Run log: ${RUN_URL}\n` : "");
      // dedupe on the set of human-facing items: an unchanged problem re-notifies once a week,
      // a new one changes the key and emails straight away.
      const key = "health:" + human.map((f) => `${f.kind}:${f.slug || ""}:${f.source || ""}`).sort().join("|").slice(0, 180);
      await sb("rpc/send_alert", {
        method: "POST",
        body: JSON.stringify({ p_kind: "health", p_subject: subject, p_body: body, p_dedupe_key: key, p_dedupe_hours: 24 * 6 }),
      });
      console.log("\nEmail sent.");
    } else {
      console.log("\nNo email — nothing fixed and nothing outstanding.");
    }
  } catch (e) {
    console.warn("alert failed:", e.message);
  }

  if (urgent.length) {
    console.log(`\nFAILING the run so it is visible: ${urgent.length} item(s) need a human now.`);
    process.exit(1);
  }
  if (human.length) console.log(`\n${human.length} item(s) for a human, none urgent — emailed, run left green.`);
  console.log("\nDone.");
})().catch((e) => {
  console.error("health check failed:", e.message);
  process.exit(1);
});
