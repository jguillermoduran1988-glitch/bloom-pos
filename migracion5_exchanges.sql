-- ============================================================
-- MIGRACIÓN 5 — Tabla de cambios y garantías
-- Corre en Supabase > SQL Editor
-- ============================================================

create table if not exists exchanges (
  id                  uuid primary key default gen_random_uuid(),
  store               text default 'bloom',
  original_sale_id    uuid,
  original_order_name text,
  new_order_name      text,
  new_shopify_order_id text,
  returned_items      jsonb default '[]',
  replacement_items   jsonb default '[]',
  refund_amount       numeric default 0,
  charge_amount       numeric default 0,
  reason              text default 'cambio',   -- cambio | garantia | devolucion
  notes               text,
  seller_name         text,
  status              text default 'completado',
  created_at          timestamptz default now()
);

alter table exchanges enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='exchanges' and policyname='allow all exchanges') then
    create policy "allow all exchanges" on exchanges for all using (true) with check (true);
  end if;
end $$;

create index if not exists idx_exchanges_original on exchanges(original_sale_id);
create index if not exists idx_exchanges_created  on exchanges(created_at desc);

-- Verificar
select count(*) as total_exchanges from exchanges;
