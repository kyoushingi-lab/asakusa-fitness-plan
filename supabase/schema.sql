begin;
create table public.weight_entries (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 120),
  exercise text not null check (exercise in ('pulldown','row','chest','triceps','abs','legpress','glute','legcurl','abductor')),
  kg numeric not null check (kg >= 0 and kg < 10000 and mod(kg,0.5)=0),
  date date not null,
  time text not null check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  at timestamptz not null,
  primary key (user_id,id)
);
alter table public.weight_entries enable row level security;
revoke all on public.weight_entries from anon, authenticated;
grant select, insert on public.weight_entries to authenticated;
create policy "read own weight history" on public.weight_entries for select to authenticated using ((select auth.uid())=user_id);
create policy "append own weight history" on public.weight_entries for insert to authenticated with check ((select auth.uid())=user_id);
create index weight_entries_user_time on public.weight_entries(user_id,at desc);
commit;
