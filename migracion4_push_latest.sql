-- ====================================================================
--  MIGRACION 4 - Ultima notificacion dinamica para Web Push
--  Pegalo en Supabase > SQL Editor y dale Run.
-- ====================================================================

create table if not exists push_latest (
  store text primary key default 'bloom',
  payload jsonb not null default '{}',
  updated_at timestamptz default now()
);

alter table push_latest enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename='push_latest' and policyname='allow all push_latest'
  ) then
    create policy "allow all push_latest" on push_latest
      for all using (true) with check (true);
  end if;
end $$;
