-- Delivery: monto de entrega que se suma al total de la venta
alter table public.sales add column if not exists delivery jsonb;

create or replace function public.create_sale(p jsonb) returns public.sales
language plpgsql security definer set search_path = public as $$
declare
  it jsonb; v_total numeric := 0; v_cost numeric := 0; v_price numeric; v_item_cost numeric; v_stock int; r public.sales;
  v_channel text := coalesce(nullif(p->>'channel', ''), 'tienda');
  v_fee numeric := coalesce(nullif(p->'delivery'->>'fee', '')::numeric, 0);
begin
  if not public.is_member() then raise exception 'No autorizado'; end if;
  if v_channel not in ('tienda', 'reventa') then raise exception 'Canal de venta inválido'; end if;
  if v_fee < 0 or v_fee > 1000 then raise exception 'Monto de delivery inválido'; end if;
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
  v_total := v_total + v_fee;
  insert into public.sales(id, date, customer_id, seller_id, rate, rate_type, doc_type, main_currency, payments, items, total, channel, cost_total, delivery, created_by)
  values (p->>'id', p->>'date', p->>'customerId', p->>'sellerId', (p->>'rate')::numeric, p->>'rateType', p->>'docType', p->>'mainCurrency',
          coalesce(p->'payments','[]'), p->'items', v_total, v_channel, case when v_channel = 'reventa' then v_cost end,
          case when v_fee > 0 then p->'delivery' end, auth.uid())
  returning * into r;
  perform public.audit('create_sale', 'sales', r.id, jsonb_build_object('total', v_total, 'channel', v_channel, 'delivery', v_fee, 'rate', p->>'rate', 'rate_type', p->>'rateType'));
  return r;
end $$;

revoke all on function public.create_sale(jsonb) from public, anon;
grant execute on function public.create_sale(jsonb) to authenticated;
