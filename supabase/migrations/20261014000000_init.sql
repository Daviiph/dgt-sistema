-- DGT Sistema: esquema, seguridad (RLS) y funciones
create extension if not exists pgcrypto;

-- PERFILES / ROLES
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'vendedor' check (role in ('admin','vendedor')),
  seller_id bigint,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin' and active);
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and active);
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- El primer usuario es admin activo; los demás quedan pendientes hasta que un admin los active
  if exists(select 1 from public.profiles where role = 'admin') then
    insert into public.profiles(id, email, full_name, role, active)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'vendedor', false);
  else
    insert into public.profiles(id, email, full_name, role, active)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'admin', true);
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- CATÁLOGO
create table if not exists public.brands (
  id bigint primary key, name text not null, extra jsonb not null default '{}', updated_at timestamptz default now());
create table if not exists public.products (
  id bigint primary key, brand_id text, name text not null, category text, color text,
  price numeric(14,2) not null default 0, stock integer not null default 0 check (stock >= 0),
  extra jsonb not null default '{}', updated_at timestamptz default now());
create table if not exists public.customers (
  id bigint primary key, name text not null, cedula text, rif text, email text, phone text,
  total_spent numeric(14,2) default 0, extra jsonb not null default '{}', updated_at timestamptz default now());
create table if not exists public.sellers (
  id bigint primary key, name text not null, comm numeric(6,4) not null default 0,
  extra jsonb not null default '{}', updated_at timestamptz default now());
create table if not exists public.payment_methods (
  id bigint primary key, name text not null, extra jsonb not null default '{}', updated_at timestamptz default now());
create table if not exists public.settings (key text primary key, value text);

-- VENTAS
create table if not exists public.sales (
  id text primary key,
  date text,
  customer_id text,
  seller_id text,
  rate numeric(14,4),
  doc_type text,
  main_currency text,
  payments jsonb not null default '[]',
  items jsonb not null default '[]',
  total numeric(14,2) not null default 0,
  status text not null default 'activa' check (status in ('activa','cancelada')),
  cancel_reason text,
  cancel_date text,
  extra jsonb not null default '{}',
  created_by uuid default auth.uid() references auth.users(id),
  cancelled_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- AUDITORÍA
create table if not exists public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  user_email text,
  action text not null,
  entity text,
  entity_id text,
  details jsonb
);

create or replace function public.audit(p_action text, p_entity text, p_entity_id text, p_details jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log(user_id, user_email, action, entity, entity_id, details)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()), p_action, p_entity, p_entity_id, p_details);
$$;

-- Auditoría automática de cambios en catálogo
create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.audit(lower(tg_op), tg_table_name,
    coalesce((case when tg_op = 'DELETE' then old.id else new.id end)::text, ''),
    case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end);
  return null;
end $$;

do $$ declare t text; begin
  foreach t in array array['brands','products','customers','sellers','payment_methods','settings','profiles'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_trigger()', t);
  end loop;
end $$;
-- settings usa key en lugar de id
create or replace function public.audit_settings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.audit(lower(tg_op), 'settings', coalesce(new.key, old.key), to_jsonb(coalesce(new, old)));
  return null;
end $$;
drop trigger if exists audit_settings on public.settings;
create trigger audit_settings after insert or update or delete on public.settings
for each row execute function public.audit_settings();

-- RLS
alter table public.profiles enable row level security;
alter table public.brands enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.sellers enable row level security;
alter table public.payment_methods enable row level security;
alter table public.settings enable row level security;
alter table public.sales enable row level security;
alter table public.audit_log enable row level security;

do $$ declare t text; begin
  foreach t in array array['brands','products','sellers','payment_methods','settings'] loop
    execute format('drop policy if exists "%1$s_read" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_admin_write" on public.%1$s', t);
    execute format('create policy "%1$s_read" on public.%1$s for select to authenticated using (public.is_member())', t);
    execute format('create policy "%1$s_admin_write" on public.%1$s for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- Clientes: todos los miembros leen, crean y editan; sólo admin elimina
drop policy if exists customers_read on public.customers;
drop policy if exists customers_insert on public.customers;
drop policy if exists customers_update on public.customers;
drop policy if exists customers_delete on public.customers;
create policy customers_read on public.customers for select to authenticated using (public.is_member());
create policy customers_insert on public.customers for insert to authenticated with check (public.is_member());
create policy customers_update on public.customers for update to authenticated using (public.is_member()) with check (public.is_member());
create policy customers_delete on public.customers for delete to authenticated using (public.is_admin());

-- Perfiles: cada uno ve el suyo, admin ve y edita todos
drop policy if exists profiles_read on public.profiles;
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_admin_update on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Ventas: admin ve todo; vendedor sólo las que registró. Escritura directa sólo admin (importación).
drop policy if exists sales_read on public.sales;
drop policy if exists sales_admin_write on public.sales;
create policy sales_read on public.sales for select to authenticated using (public.is_admin() or (public.is_member() and created_by = auth.uid()));
create policy sales_admin_write on public.sales for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Auditoría: sólo admin lee; nadie escribe directo
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (public.is_admin());

-- FUNCIONES DE VENTA
create or replace function public.create_sale(p jsonb) returns public.sales
language plpgsql security definer set search_path = public as $$
declare
  it jsonb; v_total numeric := 0; v_price numeric; v_stock int; r public.sales;
begin
  if not public.is_member() then raise exception 'No autorizado'; end if;
  if jsonb_array_length(coalesce(p->'items','[]')) = 0 then raise exception 'La venta no tiene productos'; end if;
  for it in select * from jsonb_array_elements(p->'items') loop
    select price, stock into v_price, v_stock from public.products where id = (it->>'id')::bigint for update;
    if not found then raise exception 'Producto % no existe', it->>'name'; end if;
    if (it->>'qty')::int <= 0 then raise exception 'Cantidad inválida'; end if;
    if v_stock < (it->>'qty')::int then raise exception 'Stock insuficiente para %', it->>'name'; end if;
    update public.products set stock = stock - (it->>'qty')::int, updated_at = now() where id = (it->>'id')::bigint;
    v_total := v_total + v_price * (it->>'qty')::int;
  end loop;
  insert into public.sales(id, date, customer_id, seller_id, rate, doc_type, main_currency, payments, items, total, created_by)
  values (p->>'id', p->>'date', p->>'customerId', p->>'sellerId', (p->>'rate')::numeric, p->>'docType', p->>'mainCurrency',
          coalesce(p->'payments','[]'), p->'items', v_total, auth.uid())
  returning * into r;
  perform public.audit('create_sale', 'sales', r.id, jsonb_build_object('total', v_total));
  return r;
end $$;

create or replace function public.cancel_sale(p_id text, p_reason text) returns public.sales
language plpgsql security definer set search_path = public as $$
declare it jsonb; r public.sales;
begin
  if not public.is_admin() then raise exception 'Sólo un administrador puede anular ventas'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Debe indicar el motivo'; end if;
  select * into r from public.sales where id = p_id for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if r.status = 'cancelada' then raise exception 'La venta ya está anulada'; end if;
  for it in select * from jsonb_array_elements(r.items) loop
    update public.products set stock = stock + (it->>'qty')::int, updated_at = now() where id = (it->>'id')::bigint;
  end loop;
  update public.sales set status = 'cancelada', cancel_reason = trim(p_reason),
    cancel_date = to_char(now() at time zone 'America/Caracas', 'DD/MM/YYYY, HH24:MI'), cancelled_by = auth.uid()
  where id = p_id returning * into r;
  perform public.audit('cancel_sale', 'sales', p_id, jsonb_build_object('reason', p_reason, 'total', r.total));
  return r;
end $$;

create or replace function public.delete_sale(p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.sales;
begin
  if not public.is_admin() then raise exception 'Sólo un administrador puede eliminar ventas'; end if;
  select * into r from public.sales where id = p_id;
  if not found then raise exception 'Venta no encontrada'; end if;
  if r.status <> 'cancelada' then raise exception 'Primero debe anular la venta'; end if;
  perform public.audit('delete_sale', 'sales', p_id, to_jsonb(r));
  delete from public.sales where id = p_id;
end $$;

revoke all on function public.create_sale(jsonb), public.cancel_sale(text, text), public.delete_sale(text) from public, anon;
grant execute on function public.create_sale(jsonb), public.cancel_sale(text, text), public.delete_sale(text) to authenticated;

-- Realtime
do $$ begin
  begin alter publication supabase_realtime add table public.brands, public.products, public.customers, public.sellers, public.payment_methods, public.settings, public.sales; exception when others then null; end;
end $$;
