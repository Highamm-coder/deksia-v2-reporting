-- 0025 (applied live 2026-08-05): admin layer.
-- admins table (seed: matthew@deksia.com) + is_admin() gate.
-- bug_reports: authenticated insert; admins (or the reporter) read; admins resolve.
--   AFTER INSERT trigger notify_bug_report() emails matthew@deksia.com via pg_net ->
--   Resend, key from Vault secret 'resend_api_key' (no key -> silent no-op; email
--   failure never blocks the report).
-- User management (security definer, admin-gated): admin_list_users() over
-- auth.users; admin_set_ban(user_id, banned) toggles banned_until (cannot ban self).
-- Full defs via Supabase migration `admin_and_bug_reports`.
select 1; -- marker
