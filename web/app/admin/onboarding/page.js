import { getSupabaseServer } from "../../../lib/supabase/server";
import AppShell from "../../_components/AppShell";
import AccountBrowser from "./AccountBrowser";
import { createClient, addSource } from "./actions";

export const dynamic = "force-dynamic";

const SRC_LABEL = {
  google_ads: "Google Ads", meta: "Meta ad account", ga4: "GA4 property",
  callrail: "CallRail company", pages: "Facebook Page",
};
const ID_HINT = {
  google_ads: "Customer ID, e.g. 655-301-8099",
  meta: "Ad account ID (digits only)",
  ga4: "Property ID, e.g. 408549881",
  callrail: "Company ID (COM…) — also needs the account ID",
  pages: "Page ID",
};
const MSG = {
  forbidden: ["Admins only.", "var(--off)"],
  missing: ["Name and slug are required.", "var(--off)"],
  client: ["Couldn't create the client — that slug may already exist.", "var(--off)"],
  source: ["Couldn't attach the account — check the ID.", "var(--off)"],
};

export default async function Onboarding({ searchParams }) {
  const supabase = getSupabaseServer();
  const [{ data: isAdmin }, { data: clients }, { data: sources }, { data: probes }] = await Promise.all([
    supabase.rpc("is_admin"),
    supabase.from("clients").select("id, slug, name, status").order("slug"),
    supabase.from("client_sources").select("*").order("source").order("external_id"),
    supabase.from("connection_probes").select("*"),
  ]);
  if (!isAdmin) {
    return <AppShell><h1 style={{ fontSize: 22 }}>Onboarding</h1><p className="muted">Admins only.</p></AppShell>;
  }

  const err = MSG[searchParams?.err];
  const created = searchParams?.created;

  return (
    <AppShell>
      <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>Client onboarding</h1>
      <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
        Create a client, attach its accounts, and hand out the per-account Google Ads script.
        Accounts inside the Deksia MCC report automatically; anything outside needs its own script.
      </p>
      {err && <div style={{ margin: "8px 0", fontSize: 13, color: err[1] }}>{err[0]}</div>}
      {created && <div style={{ margin: "8px 0", fontSize: 13, color: "var(--on)" }}>
        Created <strong>{created}</strong> — attach its accounts below.</div>}

      <section>
        <h2>1 · New client</h2>
        <form action={createClient} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ margin: 0, flex: 1, minWidth: 200 }}>Client name<input name="name" required placeholder="Every Child Tennessee" /></label>
          <label style={{ margin: 0 }}>Short slug<input name="slug" placeholder="ECTN" style={{ width: 130 }} /></label>
          <label style={{ margin: 0 }}>Timezone
            <select name="timezone" defaultValue="America/Detroit" style={{ width: "auto" }}>
              <option>America/Detroit</option><option>America/New_York</option><option>America/Chicago</option>
              <option>America/Denver</option><option>America/Los_Angeles</option>
            </select>
          </label>
          <button type="submit" style={{ margin: 0 }}>Create client</button>
        </form>
      </section>

      <section>
        <h2>2 · Attach an account</h2>
        <form action={addSource} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ margin: 0 }}>Client
            <select name="client_id" required defaultValue="" style={{ minWidth: 180 }}>
              <option value="" disabled>Select…</option>
              {(clients || []).map((c) => <option key={c.id} value={c.id}>{c.name || c.slug}</option>)}
            </select>
          </label>
          <label style={{ margin: 0 }}>Platform
            <select name="source" defaultValue="google_ads" style={{ width: "auto" }}>
              {Object.entries(SRC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label style={{ margin: 0, flex: 1, minWidth: 200 }}>Account / property ID
            <input name="external_id" required placeholder="655-301-8099" /></label>
          <label style={{ margin: 0, minWidth: 150 }}>Label<input name="label" placeholder="Every Child TN" /></label>
          <label style={{ margin: 0, width: 110 }}>Brand<input name="brand" placeholder="optional" /></label>
          <label style={{ margin: 0, width: 150 }}>CallRail account ID<input name="account_id" placeholder="only for CallRail" /></label>
          <label style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
            <input type="checkbox" name="outside_mcc" style={{ width: "auto", margin: 0 }} /> outside the MCC
          </label>
          <button type="submit" style={{ margin: 0 }}>Attach</button>
        </form>
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          ID formats — {Object.entries(ID_HINT).map(([k, v]) => `${SRC_LABEL[k]}: ${v}`).join(" · ")}
        </p>
      </section>

      <section>
        <h2>3 · Accounts &amp; scripts</h2>
        <AccountBrowser clients={clients || []} sources={sources || []} probes={probes || []} />
      </section>

    </AppShell>
  );
}
