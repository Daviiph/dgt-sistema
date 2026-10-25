-- Reservas / preventas: el cliente abona una parte y el saldo se cobra al entregar.
create table if not exists public.reservations (
  id bigint primary key,
  customer_id text,
  total numeric(14,2) not null default 0 check (total >= 0),
  paid numeric(14,2) not null default 0 check (paid >= 0),
  status text not null default 'activa' check (status in ('activa', 'completada', 'cancelada')),
  expires_at text,
  extra jsonb not null default '{}',
  updated_at timestamptz default now(),
  created_at timestamptz not null default now()
);

alter table public.reservations enable row level security;
drop policy if exists reservations_read on public.reservations;
drop policy if exists reservations_insert on public.reservations;
drop policy if exists reservations_update on public.reservations;
drop policy if exists reservations_delete on public.reservations;
-- Vendedores y administradores registran y actualizan reservas; sólo el administrador las borra.
create policy reservations_read on public.reservations for select to authenticated using (public.is_member());
create policy reservations_insert on public.reservations for insert to authenticated with check (public.is_member());
create policy reservations_update on public.reservations for update to authenticated using (public.is_member()) with check (public.is_member());
create policy reservations_delete on public.reservations for delete to authenticated using (public.is_admin());

drop trigger if exists audit_reservations on public.reservations;
create trigger audit_reservations after insert or update or delete on public.reservations
for each row execute function public.audit_trigger();

do $$ begin
  alter publication supabase_realtime add table public.reservations;
exception when duplicate_object or undefined_object then null; end $$;
