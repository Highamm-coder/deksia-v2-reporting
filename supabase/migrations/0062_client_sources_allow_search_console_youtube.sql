-- 0062_client_sources_allow_search_console_youtube.sql — applied live 2026-09-16. The check
-- constraint on client_sources.source still listed only the five original sources, so no
-- Search Console (or YouTube) property could be mapped — the console's Map action and a direct
-- insert both failed with client_sources_source_check. Extend the list to the two sources
-- registered in source_methods for the next integrations.
alter table public.client_sources drop constraint client_sources_source_check;
alter table public.client_sources add constraint client_sources_source_check
  check (source = any (array['google_ads','ga4','meta','callrail','pages','search_console','youtube']));
