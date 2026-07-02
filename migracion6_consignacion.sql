-- ============================================================
-- MIGRACIÓN 6 — Proveedores en consignación
-- Corre en Supabase > SQL Editor
-- ============================================================

create table if not exists consignment_suppliers (
  id            uuid primary key default gen_random_uuid(),
  store         text default 'bloom',
  name          text not null,
  contact_name  text,
  contact_phone text,
  active        boolean default true,
  created_at    timestamptz default now()
);

-- Productos de cada proveedor, vinculados a un variant_id de Shopify
create table if not exists consignment_products (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references consignment_suppliers(id) on delete cascade,
  variant_id    bigint not null,
  product_name  text not null,
  variant_title text,
  sku           text,
  barcode       text,
  cost_type     text default 'fixed',   -- 'fixed' | 'percent'
  cost_value    numeric default 0,
  active        boolean default true,
  created_at    timestamptz default now(),
  unique(supplier_id, variant_id)
);

-- Entregas parciales del proveedor (van sumando lo que "debería haber")
create table if not exists consignment_deliveries (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references consignment_suppliers(id) on delete cascade,
  delivered_at  date default current_date,
  items         jsonb not null default '[]',  -- [{variant_id, qty}]
  notes         text,
  created_at    timestamptz default now()
);

-- Cierres mensuales (conteo físico + liquidación)
create table if not exists consignment_settlements (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references consignment_suppliers(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  items         jsonb not null default '[]',
  -- items: [{variant_id, product_name, delivered_total, sold_qty, physical_count,
  --          system_expected, diff, cost_type, cost_value, amount}]
  total_amount  numeric default 0,
  status        text default 'pendiente',  -- 'pendiente' | 'pagado'
  notes         text,
  closed_at     timestamptz default now()
);

alter table consignment_suppliers   enable row level security;
alter table consignment_products    enable row level security;
alter table consignment_deliveries  enable row level security;
alter table consignment_settlements enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='consignment_suppliers' and policyname='allow all consignment_suppliers') then
    create policy "allow all consignment_suppliers" on consignment_suppliers for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='consignment_products' and policyname='allow all consignment_products') then
    create policy "allow all consignment_products" on consignment_products for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='consignment_deliveries' and policyname='allow all consignment_deliveries') then
    create policy "allow all consignment_deliveries" on consignment_deliveries for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='consignment_settlements' and policyname='allow all consignment_settlements') then
    create policy "allow all consignment_settlements" on consignment_settlements for all using (true) with check (true);
  end if;
end $$;

create index if not exists idx_consignment_products_supplier   on consignment_products(supplier_id);
create index if not exists idx_consignment_deliveries_supplier on consignment_deliveries(supplier_id);
create index if not exists idx_consignment_settlements_supplier on consignment_settlements(supplier_id);

-- Verificar
select count(*) as total_proveedores from consignment_suppliers;
