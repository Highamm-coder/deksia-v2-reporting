-- 0011: restrict console signups to @deksia.com accounts.
-- Enforced at the DATABASE level (before-insert trigger on auth.users) so it can't be
-- bypassed by calling the signup API directly with the public anon key — the /signup
-- page's server-side check is just the friendly error. Existing users are unaffected
-- (insert-only). NOTE: this also blocks dashboard-invited non-deksia users by design;
-- drop the trigger if an external account is ever genuinely needed.
create or replace function public.enforce_deksia_email()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.email is null or new.email !~* '@deksia\.com$' then
    raise exception 'signups are restricted to deksia.com accounts';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_deksia_email on auth.users;
create trigger enforce_deksia_email
  before insert on auth.users
  for each row execute function public.enforce_deksia_email();
