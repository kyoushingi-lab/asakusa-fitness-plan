-- Run after schema.sql. All test accounts and rows are rolled back.
begin;
insert into auth.users(id,email) values
('11111111-1111-4111-8111-111111111111','fitness-test-a@example.invalid'),
('22222222-2222-4222-8222-222222222222','fitness-test-b@example.invalid');
insert into public.weight_entries(user_id,id,exercise,kg,date,time,at) values
('11111111-1111-4111-8111-111111111111','rls-test-a','chest',7.5,'2026-10-19','10:00','2026-10-19T01:00:00Z'),
('22222222-2222-4222-8222-222222222222','rls-test-b','row',15,'2026-10-19','10:00','2026-10-19T01:00:00Z');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ begin
  if (select count(*) from public.weight_entries where id in ('rls-test-a','rls-test-b'))<>1 then raise exception 'RLS leaked another account';end if;
  if not exists(select 1 from public.weight_entries where id='rls-test-a') then raise exception 'Own record was inaccessible';end if;
  begin
    insert into public.weight_entries(user_id,id,exercise,kg,date,time,at) values
    ('22222222-2222-4222-8222-222222222222','rls-forbidden','row',15,'2026-10-19','10:00','2026-10-19T01:00:00Z');
    raise exception 'Cross-account insert was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform 1 from public.weight_entries limit 1;
    raise exception 'Anonymous read was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select 'PASS: own read, cross-account isolation, rejected cross-account insert, rejected anonymous read' as verification;
rollback;
