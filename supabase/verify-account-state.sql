-- Synthetic fixtures only. Run after account-state.sql; everything rolls back.
begin;
create function pg_temp.test_fitness_merge(p_rows jsonb) returns setof public.fitness_state language sql security invoker as $$ select * from public.merge_fitness_state(p_rows,auth.uid()); $$;
create function pg_temp.test_fitness_import(p_rows jsonb) returns setof public.fitness_state language sql security invoker as $$ select * from public.import_fitness_state(p_rows,auth.uid()); $$;
insert into auth.users(id,email) values
('61111111-1111-4111-8111-111111111111','fitness-state-test-a@example.invalid'),
('62222222-2222-4222-8222-222222222222','fitness-state-test-b@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub','61111111-1111-4111-8111-111111111111',true);
select * from pg_temp.test_fitness_merge('[{"kind":"setting","key":"test.chest.seat","value":"2","revision":10,"device_id":"device-a","deleted":false},{"kind":"calendar","key":"2099-01-01","value":{"plan":"a"},"revision":10,"device_id":"device-a","deleted":false}]'::jsonb);
do $$ begin
  if (select count(*) from public.fitness_state where key in ('test.chest.seat','2099-01-01')) <> 2 then raise exception 'Own insert/read failed'; end if;
  begin
    perform public.merge_fitness_state('[{"kind":"setting","key":"wrong-account-token","value":"old-private-value","revision":30,"device_id":"device-a","deleted":false}]'::jsonb,'62222222-2222-4222-8222-222222222222'::uuid);
    raise exception 'Account-switch payload was accepted';
  exception when insufficient_privilege then null; end;
  if (select value from pg_temp.test_fitness_merge('[{"kind":"setting","key":"test.chest.seat","value":"old","revision":9,"device_id":"device-z","deleted":false}]')) <> '"2"'::jsonb then raise exception 'Stale merge did not return current winner'; end if;
  if (select value from pg_temp.test_fitness_merge('[{"kind":"setting","key":"test.chest.seat","value":"7","revision":10,"device_id":"device-z","deleted":false}]')) <> '"7"'::jsonb then raise exception 'Device tie-break failed'; end if;
  if (select value from pg_temp.test_fitness_import('[{"kind":"setting","key":"test.chest.seat","value":"guest-newer","revision":999,"device_id":"device-guest","deleted":false}]')) <> '"7"'::jsonb then raise exception 'Guest import overwrote existing setting'; end if;
  perform pg_temp.test_fitness_merge('[{"kind":"calendar","key":"2099-01-01","value":null,"revision":11,"device_id":"device-a","deleted":true}]');
  perform pg_temp.test_fitness_merge('[{"kind":"calendar","key":"2099-01-01","value":{"plan":"b"},"revision":10,"device_id":"device-z","deleted":false}]');
  if not (select deleted from public.fitness_state where kind='calendar' and key='2099-01-01') then raise exception 'Old device resurrected tombstone'; end if;
  if not (select deleted from pg_temp.test_fitness_import('[{"kind":"calendar","key":"2099-01-01","value":{"plan":"a"},"revision":999,"device_id":"device-guest","deleted":false}]')) then raise exception 'Guest import resurrected tombstone'; end if;
  if (select value from pg_temp.test_fitness_import('[{"kind":"setting","key":"test.new.setting","value":"guest-value","revision":10,"device_id":"device-guest","deleted":false}]')) <> '"guest-value"'::jsonb then raise exception 'Guest import failed to insert missing item'; end if;
  begin
    insert into public.fitness_state(user_id,kind,key,value,revision,device_id,deleted) values
    ('62222222-2222-4222-8222-222222222222','latest','forbidden','7.5',1,'device-a',false);
    raise exception 'Cross-account insert was allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.fitness_state set user_id='62222222-2222-4222-8222-222222222222' where key='test.chest.seat';
    raise exception 'Ownership reassignment was allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.fitness_state where key='test.chest.seat';
    raise exception 'Hard delete was allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform pg_temp.test_fitness_merge((select jsonb_agg(jsonb_build_object('kind','latest','key','batch-'||n,'value',0,'revision',1,'device_id','test','deleted',false)) from generate_series(1,101) n));
    raise exception 'Oversized batch was allowed';
  exception when invalid_parameter_value then null; end;
  begin
    perform pg_temp.test_fitness_merge(jsonb_build_array(jsonb_build_object('kind','setting','key','oversized','value',repeat('x',16385),'revision',2,'device_id','test','deleted',false)));
    raise exception 'Oversized value was allowed';
  exception when check_violation then null; end;
end $$;
select set_config('request.jwt.claim.sub','62222222-2222-4222-8222-222222222222',true);
do $$ begin
  if exists(select 1 from public.fitness_state where key in ('test.chest.seat','2099-01-01')) then raise exception 'Other account could read A state'; end if;
  update public.fitness_state set value='"forbidden"' where user_id='61111111-1111-4111-8111-111111111111';
  if found then raise exception 'Other account updated A state'; end if;
  -- Even if browser data names A, the invoker RPC binds B from auth.uid().
  perform pg_temp.test_fitness_merge('[{"user_id":"61111111-1111-4111-8111-111111111111","kind":"setting","key":"test.chest.seat","value":"B","revision":999,"device_id":"device-b","deleted":false}]');
  if (select value from public.fitness_state where key='test.chest.seat') <> '"B"'::jsonb then raise exception 'Server-bound owner insert failed'; end if;
end $$;
select set_config('request.jwt.claim.sub','61111111-1111-4111-8111-111111111111',true);
do $$ begin
  if (select value from public.fitness_state where key='test.chest.seat') <> '"7"'::jsonb then raise exception 'RPC overwrote another account'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform 1 from public.fitness_state limit 1;
    raise exception 'Anonymous SELECT was allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform pg_temp.test_fitness_merge('[]'::jsonb);
    raise exception 'Anonymous RPC was allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: owner state CRUD permissions, cross-account isolation, server-bound owner, stale/tie/tombstone merges, size limits, anonymous rejection' as verification;
rollback;
