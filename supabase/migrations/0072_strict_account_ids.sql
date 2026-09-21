-- Keep the existing two-argument signature used by views, but only normalize
-- identifiers made entirely of digits/hyphens. URLs and channel IDs stay opaque.
create or replace function public.same_account_id(a text, b text)
returns boolean language sql immutable parallel safe as $$
  select coalesce(a <> '' and b <> '' and (
    a = b or (
      a ~ '^[0-9-]+$' and b ~ '^[0-9-]+$'
      and replace(a, '-', '') <> ''
      and replace(a, '-', '') = replace(b, '-', '')
    )
  ), false)
$$;
