-- ====================================================================
--  MIGRACIÓN 2 — Datos completos del cliente + fotos/íconos + pago mixto
--  Pégalo en Supabase > SQL Editor y dale Run.
--  (Es seguro correrlo aunque ya existan: usa IF NOT EXISTS)
-- ====================================================================

-- Datos completos del cliente en las ventas
alter table sales add column if not exists customer_doc text;
alter table sales add column if not exists alegra_invoice text;
alter table sales add column if not exists siigo_invoice text;
alter table sales add column if not exists customer_doc_type text;
alter table sales add column if not exists customer_email text;
alter table sales add column if not exists customer_address text;
alter table sales add column if not exists customer_depto text;
alter table sales add column if not exists customer_city text;

-- Pago mixto: detalle de cada medio con su monto
alter table sales add column if not exists payment_detail jsonb default '[]';

-- Foto del vendedor
alter table sellers add column if not exists photo_url text;

-- Ícono personalizado del método de pago (imagen)
alter table payment_methods add column if not exists icon_url text;

-- Facturación electrónica a empresa (adicional a los datos del cliente)
alter table sales add column if not exists billing_empresa boolean default false;
alter table sales add column if not exists billing_detail jsonb default null;

-- Cajeros (con clave corta opcional de 4 dígitos)
create table if not exists cashiers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  photo_url text,
  pin text,                      -- clave de 4 dígitos (opcional)
  require_pin boolean default false,
  active boolean default true,
  store text default 'bloom',
  created_at timestamptz default now()
);
alter table cashiers enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='cashiers' and policyname='allow all cashiers') then
    create policy "allow all cashiers" on cashiers for all using (true) with check (true);
  end if;
end $$;

-- Registrar qué cajero hizo cada venta
alter table sales add column if not exists cashier_id uuid;
alter table sales add column if not exists cashier_name text;

-- Observación libre por ítem ya va dentro de items (jsonb), no requiere columna

-- Clientes (se importan de Shopify y se buscan por cédula/nombre/celular)
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  doc text,
  doc_type text default 'CC',
  name text,
  last_name text,
  full_name text,
  email text,
  phone text,
  address text,
  depto text,
  city text,
  shopify_customer_id text,
  total_spent numeric default 0,
  orders_count int default 0,
  store text default 'bloom',
  created_at timestamptz default now()
);
alter table customers enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='customers' and policyname='allow all customers') then
    create policy "allow all customers" on customers for all using (true) with check (true);
  end if;
end $$;
-- Índices para búsqueda rápida por cédula, teléfono y nombre
create index if not exists idx_customers_doc on customers(doc);
create index if not exists idx_customers_phone on customers(phone);
create index if not exists idx_customers_name on customers(full_name);

-- Configuración del POS (borrador/pagada, recibo, etc.) — una sola fila por tienda
create table if not exists pos_settings (
  store text primary key default 'bloom',
  shopify_draft boolean default true,   -- true = crea borrador (pruebas); false = pagada
  receipt_enabled boolean default false,
  receipt_business text default 'Bloom',
  receipt_nit text default '',
  receipt_address text default '',
  receipt_phone text default '',
  receipt_footer text default '¡Gracias por tu compra!',
  iva_rate numeric default 19,
  updated_at timestamptz default now()
);
alter table pos_settings enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='pos_settings' and policyname='allow all pos_settings') then
    create policy "allow all pos_settings" on pos_settings for all using (true) with check (true);
  end if;
end $$;
insert into pos_settings (store) values ('bloom') on conflict (store) do nothing;

-- Chat interno del equipo (grupal)
create table if not exists team_messages (
  id uuid primary key default gen_random_uuid(),
  author_type text default 'cajero',   -- 'cajero' | 'vendedor'
  author_id uuid,
  author_name text not null,
  body text not null,
  sale_id uuid,                          -- si comenta una venta puntual (opcional)
  store text default 'bloom',
  created_at timestamptz default now()
);
alter table team_messages enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='team_messages' and policyname='allow all team_messages') then
    create policy "allow all team_messages" on team_messages for all using (true) with check (true);
  end if;
end $$;
create index if not exists idx_team_messages_created on team_messages(created_at);

-- Indicador "está escribiendo" del chat del equipo
create table if not exists team_typing (
  name text not null,
  store text default 'bloom',
  at timestamptz default now(),
  primary key (name, store)
);
alter table team_typing enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='team_typing' and policyname='allow all team_typing') then
    create policy "allow all team_typing" on team_typing for all using (true) with check (true);
  end if;
end $$;

-- Pedidos personalizados (con fecha de entrega y alerta)
create table if not exists custom_orders (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid,
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
create index if not exists idx_custom_orders_delivery on custom_orders(delivery_date);

-- Adjuntos en el chat del equipo (foto / audio)
alter table team_messages add column if not exists media_url text;       -- link en Storage
alter table team_messages add column if not exists media_type text;      -- 'image' | 'audio'
alter table team_messages add column if not exists media_path text;      -- ruta en el bucket (para poder borrarla)

-- ============ RETENCIÓN: borrar mensajes y archivos de +15 días ============
-- Requiere las extensiones pg_cron y http (Database > Extensions en Supabase).
create extension if not exists pg_cron;

-- Función que borra mensajes viejos. Los archivos del Storage se borran
-- con la tabla storage.objects (mismo proyecto), filtrando por fecha.
create or replace function purge_old_team_data()
returns void language plpgsql security definer as $$
begin
  -- 1) Borra archivos del bucket 'team-chat' con más de 15 días
  delete from storage.objects
   where bucket_id = 'team-chat'
     and created_at < now() - interval '15 days';
  -- 2) Borra los mensajes con más de 15 días
  delete from team_messages
   where created_at < now() - interval '15 days';
end;
$$;

-- Programa el cron todas las noches a las 3:00 AM (hora del servidor, UTC)
-- 3 AM UTC = 10 PM Colombia del día anterior.
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'purge_team_chat') then
    perform cron.schedule('purge_team_chat', '0 3 * * *', 'select purge_old_team_data();');
  end if;
end $$;
