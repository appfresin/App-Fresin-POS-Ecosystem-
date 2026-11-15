alter table public.addons
  add column if not exists sold_out boolean not null default false;

create index if not exists addons_sold_out_idx
  on public.addons (sold_out);
