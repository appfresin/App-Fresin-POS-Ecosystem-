-- Provide a trusted database timestamp for Self Order checkout.
-- Safe to rerun.

begin;

create or replace function public.get_server_time()
returns timestamptz
language sql
stable
set search_path = public
as $$
  select now();
$$;

grant execute on function public.get_server_time() to anon, authenticated;

commit;
