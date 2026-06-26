-- ====================================================================
--  MIGRACION 3 - Suscripciones Web Push para Android/iOS PWA
--  Pegalo en Supabase > SQL Editor y dale Run.
-- ====================================================================

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  author_name text,
  store text default 'bloom',
  user_agent text,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table push_subscriptions enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename='push_subscriptions' and policyname='allow all push_subscriptions'
  ) then
    create policy "allow all push_subscriptions" on push_subscriptions
      for all using (true) with check (true);
  end if;
end $$;

create index if not exists idx_push_subscriptions_store on push_subscriptions(store);
create index if not exists idx_push_subscriptions_active on push_subscriptions(active);
