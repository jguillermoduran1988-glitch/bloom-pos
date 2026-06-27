-- ============================================================
-- MIGRACIÓN FIX · Corre TODO esto en Supabase > SQL Editor
-- Asegura que todas las columnas existan (no borra nada)
-- ============================================================

-- Columnas de la tabla sales
alter table sales add column if not exists customer_doc text;
alter table sales add column if not exists customer_doc_type text;
alter table sales add column if not exists customer_email text;
alter table sales add column if not exists customer_address text;
alter table sales add column if not exists customer_depto text;
alter table sales add column if not exists customer_city text;
alter table sales add column if not exists customer_name text;
alter table sales add column if not exists customer_phone text;
alter table sales add column if not exists payment_detail jsonb default '[]';
alter table sales add column if not exists payment_method text;
alter table sales add column if not exists billing_empresa boolean default false;
alter table sales add column if not exists billing_detail jsonb default null;
alter table sales add column if not exists cashier_id uuid;
alter table sales add column if not exists cashier_name text;
alter table sales add column if not exists alegra_invoice text;
alter table sales add column if not exists siigo_invoice text;
alter table sales add column if not exists discount_type text;
alter table sales add column if not exists discount_value numeric default 0;
alter table sales add column if not exists discount_amount numeric default 0;
alter table sales add column if not exists shopify_order_id text;
alter table sales add column if not exists shopify_order_name text;
alter table sales add column if not exists seller_id uuid;
alter table sales add column if not exists seller_name text;
alter table sales add column if not exists subtotal numeric default 0;
alter table sales add column if not exists items jsonb default '[]';
alter table sales add column if not exists status text default 'completada';
alter table sales add column if not exists sale_type text default 'tienda';

-- Columnas de customers
alter table customers add column if not exists depto text;
alter table customers add column if not exists city text;
alter table customers add column if not exists doc_type text default 'CC';

-- Tabla custom_orders (pedidos personalizados)
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
alter table custom_orders enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='custom_orders' and policyname='allow all custom_orders') then
    create policy "allow all custom_orders" on custom_orders for all using (true) with check (true);
  end if;
end $$;

-- Verifica: muestra cuántas ventas hay
select count(*) as total_ventas from sales;
