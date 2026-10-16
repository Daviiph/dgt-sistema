-- Parte de pago: los equipos que entrega el cliente entran al inventario de reventa al facturar,
-- y se retiran si la venta se anula. Pegar completo en Supabase → SQL Editor → Run.
create or replace function public.create_sale(p jsonb) returns public.sales
language plpgsql security definer set search_path = public as $$
declare
  it jsonb; pay jsonb; t jsonb; v_total numeric := 0; v_cost numeric := 0; v_price numeric; v_item_cost numeric; v_stock int; r public.sales;
  v_channel text := coalesce(nullif(p->>'channel', ''), 'tienda');
  v_fee numeric := coalesce(nullif(p->'delivery'->>'fee', '')::numeric, 0);
  v_tcost numeric; v_cust text;
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
  select name into v_cust from public.customers where id::text = p->>'customerId';
  for pay in select * from jsonb_array_elements(coalesce(p->'payments','[]')) loop
    t := pay->'tradeIn';
    if t is null then continue; end if;
    v_tcost := coalesce(nullif(pay->>'amount','')::numeric, 0);
    if v_tcost <= 0 or v_tcost > v_total then raise exception 'Valor del equipo recibido inválido'; end if;
    insert into public.resale_items(id, brand, name, color, serial, supplier, cost, price, stock, notes, acquired_at, extra)
    values ((t->>'id')::bigint, coalesce(nullif(t->>'brand',''), 'Apple'), coalesce(nullif(t->>'name',''), 'Equipo recibido'), t->>'color', t->>'imei',
            coalesce(v_cust, 'Cliente') || ' (parte de pago)', v_tcost,
            greatest(coalesce(nullif(t->>'suggestedPrice','')::numeric, round(v_tcost * 1.2)), v_tcost), 1,
            concat_ws(' · ', 'Recibido como parte de pago en ' || (p->>'id'), nullif('Apple ID: ' || coalesce(t->>'appleId',''), 'Apple ID: '), nullif('Batería: ' || coalesce(t->>'battery','') || '%', 'Batería: %'), nullif(t->>'notes','')),
            to_char(now() at time zone 'America/Caracas', 'DD/MM/YYYY'),
            jsonb_build_object('condition', 'usado', 'pendingPrice', true, 'tradeInSale', p->>'id', 'appleId', t->>'appleId', 'battery', t->>'battery'))
    on conflict (id) do nothing;
  end loop;
  insert into public.sales(id, date, customer_id, seller_id, rate, rate_type, doc_type, main_currency, payments, items, total, channel, cost_total, delivery, created_by)
  values (p->>'id', p->>'date', p->>'customerId', p->>'sellerId', (p->>'rate')::numeric, p->>'rateType', p->>'docType', p->>'mainCurrency',
          coalesce(p->'payments','[]'), p->'items', v_total, v_channel, case when v_channel = 'reventa' then v_cost end,
          case when v_fee > 0 then p->'delivery' end, auth.uid())
  returning * into r;
  perform public.audit('create_sale', 'sales', r.id, jsonb_build_object('total', v_total, 'channel', v_channel, 'delivery', v_fee, 'rate', p->>'rate', 'rate_type', p->>'rateType'));
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
  delete from public.resale_items where extra->>'tradeInSale' = p_id and stock > 0;
  update public.sales set status = 'cancelada', cancel_reason = trim(p_reason),
    cancel_date = to_char(now() at time zone 'America/Caracas', 'DD/MM/YYYY, HH24:MI'), cancelled_by = auth.uid()
  where id = p_id returning * into r;
  perform public.audit('cancel_sale', 'sales', p_id, jsonb_build_object('reason', p_reason, 'total', r.total, 'channel', r.channel));
  return r;
end $$;

revoke all on function public.create_sale(jsonb), public.cancel_sale(text, text) from public, anon;
grant execute on function public.create_sale(jsonb), public.cancel_sale(text, text) to authenticated;
