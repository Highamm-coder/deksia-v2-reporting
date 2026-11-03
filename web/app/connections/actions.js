"use server";
import { getSupabaseServer } from "../../lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const back = (q = "") => { revalidatePath("/connections"); redirect(`/connections${q}`); };
// the mapping guard (migration 0080) explains itself — show its whole message, not a stub
const errQ = (error) => `?err=${encodeURIComponent(error.message.slice(0, 300))}`;

// Map a discovered account to a client. Discovery is what the credential can see; the
// mapping is what we pull. Same shape as onboarding's addSource, reached from the
// "discovered but not mapped" list.
export async function mapDiscovered(formData) {
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) back("?err=forbidden");
  const client_id = String(formData.get("client_id") || "");
  const source = String(formData.get("source") || "");
  const external_id = String(formData.get("external_id") || "").trim();
  const label = String(formData.get("label") || "").trim();
  const account_id = String(formData.get("account_id") || "").trim();   // CallRail parent account
  if (!client_id || !source || !external_id) back("?err=missing");
  const params = { confirmed: true, mapped_from: "connections/discovery" };
  if (label) params.label = label;
  if (account_id) params.account_id = account_id;
  const { error } = await supabase.from("client_sources").insert({ client_id, source, external_id, active: true, params });
  if (error) back(errQ(error));
  const { data: client } = await supabase.from("clients").select("slug").eq("id", client_id).maybeSingle();
  const probeErr = await dispatchProbe(client?.slug || "", source, external_id);
  back(`?mapped=${encodeURIComponent(external_id)}&client=${encodeURIComponent(client?.slug || "")}&source=${encodeURIComponent(source)}${probeErr ? `&probe_err=${encodeURIComponent(probeErr)}` : "&probing=1"}`);
}

// Deactivate / reactivate a mapping (never deletes history).
export async function setMappingActive(formData) {
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) back("?err=forbidden");
  const id = String(formData.get("id"));
  const active = String(formData.get("active")) === "true";
  await supabase.from("client_sources").update({ active, updated_at: new Date().toISOString() }).eq("id", id);
  back("?updated=1");
}

// Correct a mapping's account ID or label in place. History already written under the old
// ID stays attributed to it (provenance); the probe and pull use the new ID from tonight.
export async function updateMapping(formData) {
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) back("?err=forbidden");
  const id = String(formData.get("id") || "");
  const external_id = String(formData.get("external_id") || "").trim();
  const label = String(formData.get("label") || "").trim();
  if (!id || !external_id) back("?err=missing");
  const { data: row } = await supabase.from("client_sources").select("external_id, params").eq("id", id).maybeSingle();
  if (!row) back("?err=notfound");
  const params = { ...(row.params || {}) };
  if (label) params.label = label; else delete params.label;
  if (row.external_id !== external_id) {
    params.previous_ids = [...(params.previous_ids || []), { id: row.external_id, changed_at: new Date().toISOString() }];
  }
  const { error } = await supabase.from("client_sources").update({ external_id, params, updated_at: new Date().toISOString() }).eq("id", id);
  back(error ? errQ(error) : "?updated=1");
}

const normId = (source, v) => (source === "google_ads" || source === "ga4" || source === "meta" || source === "pages")
  ? String(v || "").replace(/\D/g, "") : String(v || "").trim();

// Discovery sees the account but has no real name for it (blank, or just its own ID). Goodside
// (2026-09-04): an unnamed Ads account was labelled "J&S Siding" and was Online Orchards. Same
// rule as mapping_discovered_name() in 0080; Search Console's ID is its URL, so it's never unnamed.
const isUnnamed = (d) => d.source !== "search_console" && (!String(d.name || "").trim() || normId(d.source, d.name) === normId(d.source, d.external_id));

async function dispatchProbe(slug, source, external_id) {
  const token = (process.env.GITHUB_DISPATCH_TOKEN || "").trim();
  if (!token) return "no GITHUB_DISPATCH_TOKEN in Vercel";
  const res = await fetch(
    "https://api.github.com/repos/Highamm-coder/deksia-v2-reporting/actions/workflows/orchestrate.yml/dispatches",
    { method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs: { probe_only: true, only_slug: slug, only_source: source, only_account: external_id } }) },
  );
  if (res.ok) return null;
  let why = `${res.status}`; try { const b = await res.json(); if (b?.message) why += ` ${b.message}`; } catch { /* */ }
  return `GitHub: ${why}`;
}

// Attach an account by typed ID — for accounts discovery cannot see (a property shared
// with a different Google user, a page we only Analyze, …). Hardened after Knight Watch
// (2026-09-15: ID typed one digit off twice; wrong Google user granted):
//   1. the ID is digit-normalised for Google/Meta sources;
//   2. if no discovered account matches, we WARN and ask for a confirm (never block —
//      discovery is best-effort and can lag a fresh grant);
//   3. on insert we probe the account immediately, so the verdict shows in its row.
export async function attachById(formData) {
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) back("?err=forbidden");
  const client_id = String(formData.get("client_id") || "");
  const source = String(formData.get("source") || "");
  const raw = String(formData.get("external_id") || "").trim();
  const external_id = normId(source, raw);
  const label = String(formData.get("label") || "").trim();
  const account_id = String(formData.get("account_id") || "").trim();
  const name_verified = String(formData.get("name_verified") || "").trim();
  const confirmed = String(formData.get("confirm") || "") === "1";
  if (!client_id || !source || !external_id) back("?err=missing");
  const { data: src } = await supabase.from("v_sources").select("source").eq("source", source).maybeSingle();
  if (!src) back("?err=unknown%20source");
  const { data: client } = await supabase.from("clients").select("slug").eq("id", client_id).maybeSingle();
  if (!client) back("?err=unknown%20client");

  const { data: disc } = await supabase.from("connector_discovery").select("external_id, name").eq("source", source);
  const seen = (disc || []).find((d) => normId(source, d.external_id) === external_id);
  if (!seen && !confirmed) {
    const q = new URLSearchParams({ warn: "1", client_id, source, external_id, label, account_id }).toString();
    back(`?${q}#attach`);
  }
  // seen but nameless: nothing can check the label, so a person names it from the platform itself
  const unnamed = seen && isUnnamed(seen);
  if (unnamed && !name_verified) {
    const q = new URLSearchParams({ warn: "unnamed", client_id, source, external_id, label, account_id }).toString();
    back(`?${q}#attach`);
  }
  const params = { confirmed: true, mapped_from: "connections/attach-by-id" };
  if (label || (seen && !unnamed && seen.name) || name_verified) params.label = label || (unnamed ? name_verified : seen.name);
  if (unnamed) params.name_verified = name_verified;
  if (source === "callrail" && account_id) params.account_id = account_id;
  if (!seen) params.not_in_discovery_at_attach = new Date().toISOString();
  const { error } = await supabase.from("client_sources").insert({ client_id, source, external_id, active: true, params });
  if (error) back(errQ(error));
  const probeErr = await dispatchProbe(client.slug, source, external_id);
  back(`?mapped=${encodeURIComponent(external_id)}&client=${encodeURIComponent(client.slug)}&source=${encodeURIComponent(source)}${probeErr ? `&probe_err=${encodeURIComponent(probeErr)}` : "&probing=1"}`);
}

// Probe one account now: dispatch a probe-only run scoped to it. Credentials live in
// GitHub Actions, so that is the only place a real read can happen. ~30-60 s.
export async function probeMapping(formData) {
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) back("?err=forbidden");
  const slug = String(formData.get("slug") || "");
  const source = String(formData.get("source") || "");
  const external_id = String(formData.get("external_id") || "");
  const token = (process.env.GITHUB_DISPATCH_TOKEN || "").trim();
  if (!token) back("?err=No%20GITHUB_DISPATCH_TOKEN%20in%20Vercel");
  const res = await fetch(
    "https://api.github.com/repos/Highamm-coder/deksia-v2-reporting/actions/workflows/orchestrate.yml/dispatches",
    { method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs: { probe_only: true, only_slug: slug, only_source: source, only_account: external_id } }) },
  );
  if (res.ok) back(`?probing=${encodeURIComponent(external_id)}`);
  let why = `${res.status}`;
  try { const b = await res.json(); if (b?.message) why += ` ${b.message}`; } catch { /* non-JSON */ }
  back(`?err=${encodeURIComponent(("GitHub: " + why).slice(0, 120))}`);
}

// ---- bulk actions from the grid (ids arrive as repeated "ids" fields) --------------------
const idsOf = (formData) => formData.getAll("ids").map(String).filter(Boolean);

export async function ignoreDiscovered(formData) {
  const supabase = getSupabaseServer();
  const keys = idsOf(formData);
  if (!keys.length) back("?err=nothing%20selected");
  const { error } = await supabase.rpc("set_discovery_ignored", { p_keys: keys, p_ignored: String(formData.get("undo") || "") !== "1" });
  back(error ? `?err=${encodeURIComponent(error.message.slice(0, 120))}` : `?updated=${keys.length}`);
}

// Map several discovered accounts to one client at once; one scoped probe for the client.
export async function mapDiscoveredBulk(formData) {
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) back("?err=forbidden");
  const client_id = String(formData.get("client_id") || "");
  const keys = idsOf(formData);
  if (!client_id || !keys.length) back("?err=pick%20a%20client%20and%20at%20least%20one%20account");
  const { data: client } = await supabase.from("clients").select("slug").eq("id", client_id).maybeSingle();
  if (!client) back("?err=unknown%20client");
  const { data: disc } = await supabase.from("connector_discovery").select("source, external_id, name, extra");
  const picked = keys.map((k) => (disc || []).find((d) => `${d.source}|${d.external_id}` === k)).filter(Boolean);
  // a nameless account can't be bulk-mapped: send the first one to attach-by-id to be named
  const nameless = picked.filter(isUnnamed);
  const rows = picked.filter((d) => !isUnnamed(d)).map((d) => ({
    client_id, source: d.source, external_id: d.external_id, active: true,
    params: { confirmed: true, mapped_from: "connections/bulk", ...(d.name ? { label: d.name } : {}), ...(d.extra?.account_id ? { account_id: d.extra.account_id } : {}) },
  }));
  if (!rows.length && !nameless.length) back("?err=nothing%20to%20map");
  if (rows.length) {
    const { error } = await supabase.from("client_sources").insert(rows);
    if (error) back(errQ(error));
  }
  if (nameless.length) {
    if (rows.length) await dispatchProbe(client.slug, "", "");
    const d = nameless[0];
    const q = new URLSearchParams({ warn: "unnamed", client_id, source: d.source, external_id: d.external_id,
      account_id: d.extra?.account_id || "", mapped_others: String(rows.length), nameless_left: String(nameless.length - 1) }).toString();
    back(`?${q}#attach`);
  }
  const probeErr = await dispatchProbe(client.slug, "", "");
  back(`?mapped=${rows.length}%20account(s)&client=${encodeURIComponent(client.slug)}${probeErr ? `&probe_err=${encodeURIComponent(probeErr)}` : "&probing=1"}`);
}

export async function setMappingsActive(formData) {
  const supabase = getSupabaseServer();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) back("?err=forbidden");
  const ids = idsOf(formData);
  const active = String(formData.get("active")) === "true";
  if (!ids.length) back("?err=nothing%20selected");
  await supabase.from("client_sources").update({ active, updated_at: new Date().toISOString() }).in("id", ids);
  back(`?updated=${ids.length}`);
}

export async function unignoreDiscovered(formData) {
  formData.append("undo", "1");
  return ignoreDiscovered(formData);
}
