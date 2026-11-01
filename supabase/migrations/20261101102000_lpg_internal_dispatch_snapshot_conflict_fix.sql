begin;

-- SKIMA internal dispatch has the same PL/pgSQL naming collision that was
-- previously fixed for marketplace dispatch. Keep its conflict target tied
-- to the table's unique constraint, not the local dispatch_request_id var.
do $migration$
declare
  function_ddl text;
  old_conflict_pattern constant text := 'ON CONFLICT\\s*\\(\\s*dispatch_request_id\\s*\\)\\s*DO NOTHING';
  new_conflict_clause constant text := 'ON CONFLICT ON CONSTRAINT dispatch_location_decision_snapshots_dispatch_request_id_key DO NOTHING';
  conflict_count integer;
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid='public.dispatch_location_decision_snapshots'::regclass
      and conname='dispatch_location_decision_snapshots_dispatch_request_id_key'
      and contype in ('u','p')
  ) then
    raise exception 'expected unique dispatch-request snapshot constraint is missing';
  end if;

  function_ddl := pg_get_functiondef(
    'public.dispatch_lpg_internal_order(uuid,integer,text,text)'::regprocedure
  );

  if function_ddl ~* new_conflict_clause then
    return;
  end if;

  select count(*) into conflict_count
  from regexp_matches(function_ddl, old_conflict_pattern, 'gi');

  if conflict_count <> 1 then
    raise exception
      'SKIMA internal dispatch conflict fix expected exactly one ambiguous ON CONFLICT clause; found %',
      conflict_count;
  end if;

  function_ddl := regexp_replace(
    function_ddl,
    old_conflict_pattern,
    new_conflict_clause,
    'i'
  );

  if function_ddl ~* old_conflict_pattern then
    raise exception 'SKIMA internal dispatch conflict target remains ambiguous after patch';
  end if;

  execute function_ddl;
end
$migration$;

notify pgrst,'reload schema';
commit;