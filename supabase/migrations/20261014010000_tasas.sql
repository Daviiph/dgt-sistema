-- Tasas del día BCV / Binance P2P
alter table public.sales add column if not exists rate_type text;

-- Cualquier usuario activo puede actualizar las tasas del día; el resto de la configuración sigue siendo sólo admin
drop policy if exists settings_rates_member_write on public.settings;
create policy settings_rates_member_write on public.settings for insert to authenticated
  with check (public.is_member() and key in ('rate', 'rate_bcv', 'rate_binance', 'rate_date'));
drop policy if exists settings_rates_member_update on public.settings;
create policy settings_rates_member_update on public.settings for update to authenticated
  using (public.is_member() and key in ('rate', 'rate_bcv', 'rate_binance', 'rate_date'))
  with check (public.is_member() and key in ('rate', 'rate_bcv', 'rate_binance', 'rate_date'));

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
  insert into public.sales(id, date, customer_id, seller_id, rate, rate_type, doc_type, main_currency, payments, items, total, created_by)
  values (p->>'id', p->>'date', p->>'customerId', p->>'sellerId', (p->>'rate')::numeric, p->>'rateType', p->>'docType', p->>'mainCurrency',
          coalesce(p->'payments','[]'), p->'items', v_total, auth.uid())
  returning * into r;
  perform public.audit('create_sale', 'sales', r.id, jsonb_build_object('total', v_total, 'rate', p->>'rate', 'rate_type', p->>'rateType'));
  return r;
end $$;
