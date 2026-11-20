-- Apply in the TenderKavach project's SQL editor before enabling live persistence.
begin;
create table if not exists public.bid_session_snapshots (
  session_id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  revision integer not null check (revision > 0),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.bid_session_snapshots enable row level security;
revoke all on public.bid_session_snapshots from public, anon, authenticated;
grant select, insert, update, delete on public.bid_session_snapshots to service_role;
commit;
