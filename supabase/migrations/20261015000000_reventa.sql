-- Reventa: equipos conseguidos por fuera (no son inventario de tienda) y ventas separadas por canal

-- EQUIPOS DE REVENTA
create table if not exists public.resale_items (
  id bigint primary key,
  brand text,
  name text not null,
  color text,
  serial text,
  supplier text,
  cost numeric(14,2) not null default 0 check (cost >= 0),
  price numeric(14,2) not null default 0 check (price >= 0),
  stock integer not null default 1 check (stock >= 0),
  notes text,
  acquired_at text,
  extra jsonb not null default '{}',
  updated_at timestamptz default now(),
  created_at timestamptz not null default now()
);

alter table public.resale_items enable row level security;
drop policy if exists resale_items_read on public.resale_items;
drop policy if exists resale_items_admin_write on public.resale_items;
create policy resale_items_read on public.resale_items for select to authenticated using (public.is_member());
create policy resale_items_admin_write on public.resale_items for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop trigger if exists audit_resale_items on public.resale_items;
create trigger audit_resale_items after insert or update or delete on public.resale_items
for each row execute function public.audit_trigger();

-- VENTAS: canal (tienda / reventa) y costo para calcular ganancia
alter table public.sales add column if not exists channel text not null default 'tienda';
alter table public.sales add column if not exists cost_total numeric(14,2);
do $$ begin
  alter table public.sales add constraint sales_channel_check check (channel in ('tienda', 'reventa'));
exception when duplicate_object then null; end $$;

-- El logo de la tienda se guarda en settings: no copiar la imagen completa a la auditoría
create or replace function public.audit_settings() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_key text := case when tg_op = 'DELETE' then old.key else new.key end;
  v_value text := case when tg_op = 'DELETE' then old.value else new.value end;
begin
  perform public.audit(lower(tg_op), 'settings', v_key,
    jsonb_build_object('key', v_key, 'value', case when v_key = 'brand_logo' then '[imagen]' else v_value end));
  return null;
end $$;

create or replace function public.create_sale(p jsonb) returns public.sales
language plpgsql security definer set search_path = public as $$
declare
  it jsonb; v_total numeric := 0; v_cost numeric := 0; v_price numeric; v_item_cost numeric; v_stock int; r public.sales;
  v_channel text := coalesce(nullif(p->>'channel', ''), 'tienda');
begin
  if not public.is_member() then raise exception 'No autorizado'; end if;
  if v_channel not in ('tienda', 'reventa') then raise exception 'Canal de venta inválido'; end if;
  if jsonb_array_length(coalesce(p->'items','[]')) = 0 then raise exception 'La venta no tiene productos'; end if;
  for it in select * from jsonb_array_elements(p->'items') loop
    if (it->>'qty')::int <= 0 then raise exception 'Cantidad inválida'; end if;
    if v_channel = 'reventa' then
      select price, cost, stock into v_price, v_item_cost, v_stock from public.resale_items where id = (it->>'id')::bigint for update;
      if not found then raise exception 'Equipo de reventa % no existe', it->>'name'; end if;
      if v_stock < (it->>'qty')::int then raise exception 'Equipo % ya fue vendido', it->>'name'; end if;
      update public.resale_items set stock = stock - (it->>'qty')::int, updated_at = now() where id = (it->>'id')::bigint;
      v_cost := v_cost + v_item_cost * (it->>'qty')::int;
    else
      select price, stock into v_price, v_stock from public.products where id = (it->>'id')::bigint for update;
      if not found then raise exception 'Producto % no existe', it->>'name'; end if;
      if v_stock < (it->>'qty')::int then raise exception 'Stock insuficiente para %', it->>'name'; end if;
      update public.products set stock = stock - (it->>'qty')::int, updated_at = now() where id = (it->>'id')::bigint;
    end if;
    v_total := v_total + v_price * (it->>'qty')::int;
  end loop;
  insert into public.sales(id, date, customer_id, seller_id, rate, rate_type, doc_type, main_currency, payments, items, total, channel, cost_total, created_by)
  values (p->>'id', p->>'date', p->>'customerId', p->>'sellerId', (p->>'rate')::numeric, p->>'rateType', p->>'docType', p->>'mainCurrency',
          coalesce(p->'payments','[]'), p->'items', v_total, v_channel, case when v_channel = 'reventa' then v_cost end, auth.uid())
  returning * into r;
  perform public.audit('create_sale', 'sales', r.id, jsonb_build_object('total', v_total, 'channel', v_channel, 'rate', p->>'rate', 'rate_type', p->>'rateType'));
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
    if r.channel = 'reventa' then
      update public.resale_items set stock = stock + (it->>'qty')::int, updated_at = now() where id = (it->>'id')::bigint;
    else
      update public.products set stock = stock + (it->>'qty')::int, updated_at = now() where id = (it->>'id')::bigint;
    end if;
  end loop;
  update public.sales set status = 'cancelada', cancel_reason = trim(p_reason),
    cancel_date = to_char(now() at time zone 'America/Caracas', 'DD/MM/YYYY, HH24:MI'), cancelled_by = auth.uid()
  where id = p_id returning * into r;
  perform public.audit('cancel_sale', 'sales', p_id, jsonb_build_object('reason', p_reason, 'total', r.total, 'channel', r.channel));
  return r;
end $$;

revoke all on function public.create_sale(jsonb), public.cancel_sale(text, text) from public, anon;
grant execute on function public.create_sale(jsonb), public.cancel_sale(text, text) to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.resale_items; exception when others then null; end;
end $$;
