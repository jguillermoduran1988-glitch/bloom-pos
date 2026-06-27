-- ============================================================
-- FIX tabla custom_orders (pedidos personalizados)
-- Corre esto en Supabase > SQL Editor
-- Cambia sale_id a text por si quedó como uuid
-- ============================================================

-- Si la tabla existe con sale_id uuid, lo cambia a text
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_name='custom_orders' and column_name='sale_id' and data_type='uuid'
  ) then
    alter table custom_orders alter column sale_id type text using sale_id::text;
  end if;
end $$;

-- Asegura que la tabla existe con la estructura correcta
create table if not exists custom_orders (
  id uuid primary key default gen_random_uuid(),
  sale_id text,
  product_name text,
  variant text,
  price numeric default 0,
  notes text,
  delivery_date date,
  customer_name text,
  customer_phone text,
  delivered boolean default false,
  store text default 'bloom',
  created_at timestamptz default now()
);

-- Asegura columnas por si faltan
alter table custom_orders add column if not exists notes text;
alter table custom_orders add column if not exists delivery_date date;
alter table custom_orders add column if not exists delivered boolean default false;
alter table custom_orders add column if not exists customer_name text;
alter table custom_orders add column if not exists customer_phone text;

-- RLS
alter table custom_orders enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='custom_orders' and policyname='allow all custom_orders') then
    create policy "allow all custom_orders" on custom_orders for all using (true) with check (true);
  end if;
end $$;

-- Verifica
select count(*) as total_personalizados from custom_orders;
