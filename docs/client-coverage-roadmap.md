# Client Data Coverage Roadmap

What each active client needs to be fully flowing into the platform (`metrics_daily`).
Generated from live platform state on 2026-06-19.

**Legend:** ✅ flowing · 🔧 configured, needs a pull (no client action — we run it) ·
⚠️ needs setup action · ❓ IDs not yet identified · ➖ not in this client's goals / out of scope

| Client | Google Ads | Meta | GA4 | CallRail | Pages |
|---|---|---|---|---|---|
| **Deksia** | ✅ | ✅ | ✅ | ✅ | 🔧 |
| **ECH** | ✅ | ✅ | ⚠️ | ✅ | 🔧 |
| **Green Shield** | ⚠️ script | ✅ | ⚠️ | ✅ | 🔧 |
| **Seven Apart** | ⚠️ script | ✅ | ➖ | ✅ | 🔧 |
| **Kellogg** | ✅ | ✅ | ⚠️ | ➖ | 🔧 |
| **3G** | ✅ | ➖ | ➖ | ✅ | 🔧 |
| **Veritas** | ✅ | ➖ | ⚠️ | ✅ | ➖ |
| **Cascade** | ✅ | ➖ | ⚠️ | ➖ | ➖ |
| **BHS** | ✅ | ➖ | ⚠️ | ➖ | ➖ |
| **Moda** | ✅ | ⚠️ confirm | ⚠️ | ➖ | 🔧 |
| **Contingent** | ⚠️ script | ✅ (TN ⏳) | ➖ | ➖ | ➖ |
| **Engelsma Homes** | ⚠️ script | 🔧 | ➖ | ✅ | 🔧 |
| **Hatton Power** | ⚠️ script | 🔧 (no spend) | ➖ | ✅ | 🔧 |
| **SST** | ➖ | ✅ | ⚠️ | ➖ | 🔧 |
| **RBMitchell** | ➖ | 🔧 | ➖ | ➖ | 🔧 |
| **Thornapple** | ➖ | 🔧 | ➖ | ✅ | 🔧 |
| **StraightLineFence** | ⚠️ script | ➖ | ⚠️ | ✅ | 🔧 |
| **Oleandri Wines** | ➖ | ⚠️ confirm | ➖ | ➖ | 🔧 |
| **KTU Pash** (paused) | ➖ | ⚠️ confirm | ➖ | 🔧 | ⚠️ which page |
| **Crystal Clean** | ❓ | ❓ | ⚠️ | ❓ | ➖ |
| **Goodside** | ❓ | ➖ | ⚠️ | ❓ | ❓ |
| **Morrison** | ➖ | ➖ | ⚠️ | ➖ | ➖ |
| **Nectar** | ➖ | ➖ | ⚠️ | ➖ | ➖ |
| **SAMorman** | ➖ | ➖ | ⚠️ | ➖ | ➖ |
| **Perchance** | ➖ | ➖ | ➖ | ➖ | ❓ |
| **Signcomp** | ➖ | ➖ | ➖ | ➖ | ➖ (email only) |

---

## Action queues (work these in batches)

### A. Google Ads — add per-account script (manager links exist, accounts outside the 929 MCC)
Paste `orchestrator/google-ads-account-script.js` into each account's own Scripts, schedule daily:
- **Green Shield, Seven Apart, Engelsma Homes, Hatton Power, Contingent** — accounts known, just need the script.
- **Crystal Clean, Goodside** — same script; their CID is captured automatically on first run (then we seed it).

> Already flowing via the 929 MCC: 3G, BHS, Cascade, Deksia, ECH, Kellogg, Moda, Veritas.

### B. Meta — confirm which account(s) (multiple candidates flagged `unconfirmed`)
We need you to confirm the right ad account per client, then we activate + pull:
- **Moda** — Health (651196776743431) / Medicare (567942467523634) / Pebb (309296895016284)
- **Oleandri Wines** — 860604639208429 / 1404499337464339
- **KTU Pash** — 4 candidates (paused client — low priority)
- **Contingent** — OR + AR live; **TN (999503171617145) ⏳ blocked by Meta's MCP rollout** (auto-activates when enabled)

### C. Meta — just needs a pull (account known, no client action)
We run the ingest; nothing for you to do:
- **Engelsma Homes, Thornapple, RBMitchell, Hatton Power** (Hatton has no payment method → expect ~0 spend)

### D. GA4 — map the property ID  ← biggest single gap
Only **Deksia** (308093077) is mapped today. Every client with a sessions/SEO/conversion goal needs its GA4 property ID added to `client_sources`:
- **High value:** Kellogg, Moda, Cascade, ECH, Green Shield, BHS, Veritas, SST, StraightLineFence
- **Needs-mapping clients:** Crystal Clean, Goodside, Morrison, Nectar, SAMorman
- (Also confirm the owner of property 308093077 — currently assumed Deksia.)

### E. Pages (organic Facebook) — enable insights + first pull
Page IDs are configured but **no Pages data is flowing yet** — historically only ~3 pages were readable. Each needs a Business-Manager **"Analyze"** role granted, then we pull:
- Deksia, ECH, Green Shield, Seven Apart, Kellogg, Engelsma, Hatton, Thornapple, RBMitchell, SST, Moda, Oleandri, 3G, StraightLineFence (+ KTU: pick which of its 4 pages)

### F. "Needs mapping" clients — identify account IDs first
No source IDs on file yet — we need the account identifiers before anything flows:
- **Crystal Clean, Goodside, Morrison, Nectar, SAMorman, Perchance, Signcomp**
- (Several are SEO-only → mostly resolved by the GA4 mapping in queue D once the property IDs are known.)

### G. Out of scope (no connector — won't flow regardless)
YouTube, OTT, Pinterest, LinkedIn, Email metrics, and direct/SQL/CRM figures. These stay `Awaiting / out-of-scope` on the goal tabs by design.

---

## Priority order (most coverage unlocked per unit of effort)
1. **GA4 property mapping** (queue D) — one ID per client, unlocks the largest number of pending goals.
2. **Google Ads per-account scripts** (queue A) — 7 clients, you have the access; ~5 min each.
3. **Confirm ambiguous Meta accounts** (queue B) — 3 active clients (Moda, Oleandri, + KTU paused).
4. **Meta pulls** (queue C) — no client action, we run them.
5. **Pages "Analyze" roles** (queue E) — unblocks organic.
6. **Needs-mapping ID discovery** (queue F).
