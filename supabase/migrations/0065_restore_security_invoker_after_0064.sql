-- 0065_restore_security_invoker_after_0064.sql — applied live 2026-09-16. CREATE OR REPLACE VIEW in
-- 0064 dropped the security_invoker option on the seven rewritten views (the advisor flagged them as
-- SECURITY DEFINER, as it did in 0048). Restore it, and pin search_path on same_account_id().
-- Lesson: any migration that replaces a view must re-assert security_invoker = true.
alter view public.v_client_breakouts      set (security_invoker = true);
alter view public.v_client_campaign_drill set (security_invoker = true);
alter view public.v_client_campaigns      set (security_invoker = true);
alter view public.v_client_campaigns_all  set (security_invoker = true);
alter view public.v_client_events         set (security_invoker = true);
alter view public.v_client_monthly        set (security_invoker = true);
alter view public.v_client_report_detail  set (security_invoker = true);
alter function public.same_account_id(text, text) set search_path = '';
