alter table public.device_push_tokens
  add column if not exists kitchen_categories text[] not null default '{}'::text[];
