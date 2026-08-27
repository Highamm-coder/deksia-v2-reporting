# Metric catalog — Meta Ads & Google Ads

What each platform can give us, what we currently pull, and what's left. Status key:
**✅ pulling** · **➕ recommend** (available + useful, not yet pulled) · **○ available**
(possible, low value or niche) · **⛔ not available** (platform doesn't expose it).

Grain matters: a metric is only trustworthy at the grain the platform computes it.
Counts sum; rates do not. That rule governs this whole document.

---

## META ADS (Graph API v21 — `/act_{id}/insights`)

### Spend & delivery
| Metric | Grain | Status |
|---|---|---|
| spend | ad / campaign / account | ✅ pulling (ad level) |
| impressions | ad / campaign / account | ✅ pulling |
| reach (unique people) | campaign / account only — NOT summable | ✅ pulling |
| frequency | campaign / account | ✅ pulling (campaign) |
| cpm | campaign / account | ✅ pulling (campaign) |
| cpp (cost per 1k reach) | campaign / account | ➕ recommend |
| social_spend | account | ○ available |
| full_view_impressions / full_view_reach | campaign | ○ available |

### Clicks & engagement
| Metric | Grain | Status |
|---|---|---|
| clicks (all) | ad / campaign | ✅ pulling |
| inline_link_clicks ("link clicks") | ad / campaign | ✅ pulling |
| unique_clicks | campaign | ➕ recommend |
| outbound_clicks / unique_outbound_clicks | campaign | ➕ recommend |
| ctr (all clicks) | campaign / account | ✅ pulling |
| unique_ctr | campaign | ➕ recommend |
| inline_link_click_ctr ("link CTR") | campaign | ➕ recommend — the one clients ask about |
| outbound_clicks_ctr | campaign | ➕ recommend |
| cpc | campaign / account | ✅ pulling |
| cost_per_inline_link_click | campaign | ➕ recommend |
| cost_per_unique_click | campaign | ○ available |
| cost_per_outbound_click | campaign | ○ available |

### Conversions & value
| Metric | Grain | Status |
|---|---|---|
| actions (all action types) | ad / campaign | ✅ partially — we take `lead` only |
| actions: purchase, add_to_cart, initiate_checkout, complete_registration, contact, submit_application, schedule, subscribe, start_trial, landing_page_view, video_view, post_engagement, page_engagement, like, comment, share, photo_view, rsvp | ad / campaign | ➕ recommend — store ALL action types like Google's conversion actions |
| action_values / conversion_values | ad / campaign | ➕ recommend (revenue, where the pixel sends value) |
| cost_per_action_type (per action) | campaign / account | ✅ partially — `lead` only → ➕ all types |
| purchase_roas / website_purchase_roas | campaign | ➕ recommend for e-comm clients |
| unique_actions | campaign | ○ available |
| cross-device / offline conversions | campaign | ○ available (needs setup per client) |

### Video
| Metric | Grain | Status |
|---|---|---|
| video_play_actions (plays) | ad / campaign | ➕ recommend |
| video_thruplay_watched_actions | ad / campaign | ➕ recommend — Meta's headline video metric |
| video_p25/p50/p75/p95/p100_watched_actions | ad / campaign | ➕ recommend (retention curve) |
| video_avg_time_watched_actions | ad / campaign | ➕ recommend |
| video_continuous_2_sec / 30_sec_watched | ad / campaign | ○ available |
| cost_per_thruplay | campaign | ➕ recommend |

### Quality & diagnostics
| Metric | Grain | Status |
|---|---|---|
| quality_ranking | ad | ➕ recommend (below/average/above average) |
| engagement_rate_ranking | ad | ➕ recommend |
| conversion_rate_ranking | ad | ➕ recommend |
| estimated_ad_recallers / recall_rate | campaign | ○ available (brand campaigns only) |

### Breakdowns (segment ANY of the above)
| Breakdown | Status |
|---|---|
| publisher_platform (FB / IG / Audience Network / Messenger) | ➕ recommend — "how much is Instagram vs Facebook" |
| platform_position (feed, story, reels, …) | ➕ recommend |
| impression_device / device_platform | ➕ recommend |
| age, gender | ➕ recommend (demographics reporting) |
| country / region / DMA | ○ available |
| hourly (by time of day) | ○ available |
| action_type / action_destination | ➕ (comes with storing all actions) |
> Caution: breakdowns multiply row count (age × gender × platform = big). Pull the
> two or three that get used, not all of them.

### Structural / non-metric fields
objective, optimization_goal, buying_type, attribution_setting, ad creative body/
title/thumbnail, ad status, budget & bid — ○ available, useful for context columns.

---

## GOOGLE ADS (Ads Scripts / GAQL — `AdsApp.search`)

### Spend & delivery
| Metric | Grain | Status |
|---|---|---|
| impressions | ad / ad group / campaign / account | ✅ pulling (ad group + ad) |
| clicks | same | ✅ pulling |
| cost_micros (spend) | same | ✅ pulling |
| average_cpc | campaign / account | ✅ pulling |
| average_cpm | campaign / account | ✅ pulling |
| average_cpv (cost per view) | campaign (video) | ➕ recommend |
| average_cost | campaign | ○ available |
| ctr | campaign / account | ✅ pulling |
| interactions / interaction_rate | campaign | ✅ pulling (rate) |
| engagements / engagement_rate | campaign | ○ available |

### Conversions & value
| Metric | Grain | Status |
|---|---|---|
| conversions | ad group / campaign | ✅ pulling |
| conversions by conversion action name | campaign | ✅ pulling |
| all_conversions | campaign | ➕ recommend (includes unimported types) |
| conversions_value / all_conversions_value | campaign | ✅ pulling (conversions_value) |
| cost_per_conversion | campaign / account | ✅ pulling |
| cost_per_all_conversions | campaign | ○ available |
| conversions_from_interactions_rate (conv. rate) | campaign | ➕ recommend |
| value_per_conversion | campaign | ➕ recommend |
| view_through_conversions | campaign | ➕ recommend (display/video) |
| cross_device_conversions | campaign | ○ available |
| conversion action CATEGORY (lead/purchase/call) | campaign | ➕ recommend — lets us split real leads from micro-conversions |

### Auction / competitive (Google-only, no Meta equivalent)
| Metric | Grain | Status |
|---|---|---|
| search_impression_share | campaign | ✅ pulling |
| absolute_top_impression_percentage | campaign | ✅ pulling |
| top_impression_percentage | campaign | ➕ recommend |
| search_budget_lost_impression_share | campaign | ➕ recommend — "we're capped by budget" |
| search_rank_lost_impression_share | campaign | ➕ recommend — "we're losing on rank/quality" |
| search_click_share | campaign | ➕ recommend |
| search_exact_match_impression_share | campaign | ○ available |

### Video (YouTube)
| Metric | Grain | Status |
|---|---|---|
| video_views / video_view_rate | campaign | ➕ recommend |
| video_quartile_p25/p50/p75/p100_rate | campaign | ➕ recommend |

### Calls
| Metric | Grain | Status |
|---|---|---|
| phone_calls / phone_impressions / phone_through_rate | campaign | ➕ recommend (call extensions) |

### Quality
| Metric | Grain | Status |
|---|---|---|
| historical_quality_score | keyword | ➕ recommend (needs keyword_view) |
| historical_creative_quality_score / landing_page / expected_ctr | keyword | ➕ recommend |

### Dimensions we don't report on yet (each is a new GAQL resource)
| Resource | What it gives | Status |
|---|---|---|
| keyword_view | per-keyword spend/clicks/conv + quality score | ➕ recommend — biggest gap for search clients |
| search_term_view | actual queries people typed | ➕ recommend — high client value |
| geographic_view | performance by location | ➕ recommend |
| age_range_view / gender_view | demographics (parity with Meta) | ➕ recommend |
| asset_group (PMax) | asset-group performance for Performance Max | ➕ recommend — our PMax campaigns are otherwise opaque |
| landing_page_view | per-URL performance | ○ available |
| shopping_performance_view | product-level (retail clients) | ○ available |
| segments.device | mobile / desktop / tablet split | ➕ recommend |
| segments.ad_network_type | Search / Search partners / Display / YouTube | ➕ recommend |
| segments.day_of_week, hour | dayparting | ○ available |

### ⛔ Not available via Ads Scripts
Impression-share metrics below campaign level for some campaign types; PMax
ad-group-level anything (no ad groups exist); raw auction-insights competitor data.

---

## Honest caveats
1. Field availability varies by **API version, campaign type, and account setup**
   (e.g. ROAS needs value-tracking pixels; quality score needs keywords; impression
   share is search/shopping only). Anything marked ➕ can still come back empty for a
   given account — the scripts skip nulls rather than writing zeros.
2. This list is compiled from the documented API surface. The **authoritative** list
   is whatever the account returns — a discovery run can dump exactly which fields
   respond per account if you want that verified rather than trusted.
3. Volume: every added grain/breakdown multiplies rows. Current table is ~1M rows;
   keyword + search-term data for the search-heavy clients is the one addition that
   could multiply that meaningfully.
