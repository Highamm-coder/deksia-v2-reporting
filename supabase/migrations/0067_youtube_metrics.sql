-- 0067_youtube_metrics.sql — applied live 2026-09-16. metric_definitions for youtube, registered up
-- front so aggregation is explicit rather than inferred from the name (ensure_metric_defs inserts
-- only missing names). Two families that are never mixed:
--   • YouTube Analytics API (day × channel, manager access needed): views, watch_minutes,
--     avg_view_duration_sec (a rate — avg, never summed), subscribers_gained/lost, likes, comments, shares.
--   • YouTube Data API public snapshot (any channel): *_total = lifetime counts as of the pull,
--     agg = last (a stock, not a flow — the month shows the latest snapshot).
insert into public.metric_definitions (source, metric_name, unit, agg, direction_default, description, provenance) values
 ('youtube','views','int','sum','increase','Video views on the channel that day','YouTube Analytics API v2 reports.query — views, day × channel'),
 ('youtube','watch_minutes','int','sum','increase','Estimated minutes watched that day','YouTube Analytics API v2 reports.query — estimatedMinutesWatched'),
 ('youtube','avg_view_duration_sec','sec','avg','increase','Average view duration (seconds) as YouTube reports it per day; a rate, averaged across days, never summed','YouTube Analytics API v2 reports.query — averageViewDuration'),
 ('youtube','subscribers_gained','int','sum','increase','Subscribers gained that day','YouTube Analytics API v2 reports.query — subscribersGained'),
 ('youtube','subscribers_lost','int','sum','decrease','Subscribers lost that day','YouTube Analytics API v2 reports.query — subscribersLost'),
 ('youtube','likes','int','sum','increase','Likes that day','YouTube Analytics API v2 reports.query — likes'),
 ('youtube','comments','int','sum','increase','Comments that day','YouTube Analytics API v2 reports.query — comments'),
 ('youtube','shares','int','sum','increase','Shares that day','YouTube Analytics API v2 reports.query — shares'),
 ('youtube','subscribers_total','int','last','increase','Lifetime subscriber count as of the pull (public snapshot; hidden counts are not stored)','YouTube Data API v3 channels.list statistics.subscriberCount — public snapshot dated the pull day'),
 ('youtube','views_total','int','last','increase','Lifetime channel views as of the pull (public snapshot)','YouTube Data API v3 channels.list statistics.viewCount — public snapshot dated the pull day'),
 ('youtube','videos_total','int','last','increase','Public video count as of the pull (public snapshot)','YouTube Data API v3 channels.list statistics.videoCount — public snapshot dated the pull day')
on conflict (source, metric_name) do update
  set unit = excluded.unit, agg = excluded.agg, direction_default = excluded.direction_default,
      description = excluded.description, provenance = excluded.provenance;
