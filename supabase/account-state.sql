-- Private account state. This does not change append-only weight_entries.
-- Rows are independent logical controls/dates; deletions remain tombstones so
-- an offline device cannot recreate a removed calendar/check-in entry.
create table public.fitness_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('calendar','checkin','setting','latest','preference')),
  key text not null check (length(key) between 1 and 160),
  value jsonb not null check (octet_length(value::text) <= 16384),
  revision bigint not null check (revision between 1 and 9007199254740991),
  device_id text collate "C" not null check (length(device_id) between 1 and 120),
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id,kind,key)
);
alter table public.fitness_state enable row level security;
revoke all on public.fitness_state from public, anon, authenticated;
grant select, insert, update on public.fitness_state to authenticated;
create policy fitness_state_owner_select on public.fitness_state for select to authenticated
  using ((select auth.uid()) = user_id);
create policy fitness_state_owner_insert on public.fitness_state for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy fitness_state_owner_update on public.fitness_state for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- A single atomic upsert resolves each logical row by (revision, device_id).
-- A second SELECT returns current winners even for unchanged/stale input rows.
create or replace function public.merge_fitness_state(p_rows jsonb, p_expected_user uuid)
returns setof public.fitness_state
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  item jsonb;
begin
  if owner_id is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if owner_id is distinct from p_expected_user then
    raise exception 'Account changed during sync' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'State batch must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 100 then
    raise exception 'State batch exceeds 100 rows' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'kind') is distinct from 'string'
      or jsonb_typeof(item->'key') is distinct from 'string'
      or jsonb_typeof(item->'revision') is distinct from 'number'
      or jsonb_typeof(item->'device_id') is distinct from 'string'
      or jsonb_typeof(item->'deleted') is distinct from 'boolean'
      or not (item ? 'value') then
      raise exception 'Invalid state row' using errcode = '22023';
    end if;
    if (item->>'revision')::numeric <> trunc((item->>'revision')::numeric) then
      raise exception 'State revision must be an integer' using errcode = '22023';
    end if;
  end loop;
  insert into public.fitness_state as target
    (user_id,kind,key,value,revision,device_id,deleted,updated_at)
  select owner_id, input.kind, input.key, input.value, input.revision,
    input.device_id, input.deleted, now()
  from (
    select distinct on (row_data->>'kind', row_data->>'key')
      row_data->>'kind' as kind, row_data->>'key' as key, row_data->'value' as value,
      (row_data->>'revision')::bigint as revision,
      (row_data->>'device_id') collate "C" as device_id,
      (row_data->>'deleted')::boolean as deleted
    from jsonb_array_elements(p_rows) as rows(row_data)
    order by row_data->>'kind', row_data->>'key',
      (row_data->>'revision')::bigint desc, (row_data->>'device_id') collate "C" desc
  ) as input
  on conflict (user_id,kind,key) do update set
    value = excluded.value, revision = excluded.revision,
    device_id = excluded.device_id, deleted = excluded.deleted, updated_at = now()
  where (excluded.revision,excluded.device_id) > (target.revision,target.device_id);
  return query
  select current_row.* from public.fitness_state as current_row
  where current_row.user_id = owner_id and exists (
    select 1 from jsonb_array_elements(p_rows) as requested(item)
    where requested.item->>'kind' = current_row.kind and requested.item->>'key' = current_row.key
  ) order by current_row.kind,current_row.key;
end;
$$;
revoke all on function public.merge_fitness_state(jsonb,uuid) from public, anon;
grant execute on function public.merge_fitness_state(jsonb,uuid) to authenticated;

-- Explicit guest import inserts only missing items, preserving concurrent
-- account edits and tombstones regardless of the guest revision.
create or replace function public.import_fitness_state(p_rows jsonb, p_expected_user uuid)
returns setof public.fitness_state
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  item jsonb;
begin
  if owner_id is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if owner_id is distinct from p_expected_user then
    raise exception 'Account changed during sync' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'State batch must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 100 then
    raise exception 'State batch exceeds 100 rows' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'kind') is distinct from 'string'
      or jsonb_typeof(item->'key') is distinct from 'string'
      or jsonb_typeof(item->'revision') is distinct from 'number'
      or jsonb_typeof(item->'device_id') is distinct from 'string'
      or jsonb_typeof(item->'deleted') is distinct from 'boolean'
      or not (item ? 'value') then
      raise exception 'Invalid state row' using errcode = '22023';
    end if;
    if (item->>'revision')::numeric <> trunc((item->>'revision')::numeric) then
      raise exception 'State revision must be an integer' using errcode = '22023';
    end if;
  end loop;
  insert into public.fitness_state as target
    (user_id,kind,key,value,revision,device_id,deleted,updated_at)
  select owner_id, input.kind, input.key, input.value, input.revision,
    input.device_id, input.deleted, now()
  from (
    select distinct on (row_data->>'kind', row_data->>'key')
      row_data->>'kind' as kind, row_data->>'key' as key, row_data->'value' as value,
      (row_data->>'revision')::bigint as revision,
      (row_data->>'device_id') collate "C" as device_id,
      (row_data->>'deleted')::boolean as deleted
    from jsonb_array_elements(p_rows) as rows(row_data)
    order by row_data->>'kind', row_data->>'key',
      (row_data->>'revision')::bigint desc, (row_data->>'device_id') collate "C" desc
  ) as input
  on conflict (user_id,kind,key) do nothing;
  return query
  select current_row.* from public.fitness_state as current_row
  where current_row.user_id = owner_id and exists (
    select 1 from jsonb_array_elements(p_rows) as requested(item)
    where requested.item->>'kind' = current_row.kind and requested.item->>'key' = current_row.key
  ) order by current_row.kind,current_row.key;
end;
$$;
revoke all on function public.import_fitness_state(jsonb,uuid) from public, anon;
grant execute on function public.import_fitness_state(jsonb,uuid) to authenticated;
