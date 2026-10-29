-- Fix the atomic LPG payment + driver-dispatch path.
-- dispatch_lpg_order() declares a PL/pgSQL variable named dispatch_request_id.
-- The unqualified ON CONFLICT (dispatch_request_id) target therefore raises
-- SQLSTATE 42702 inside dispatch_location_decision_snapshots, rolling back
-- wallet reservation and assignment. Name the table's unique constraint
-- explicitly so the conflict target cannot be resolved as a PL/pgSQL variable.

do $migration$
declare
  function_ddl text;
  old_conflict_pattern constant text := 'ON CONFLICT\s*\(\s*dispatch_request_id\s*\)\s*DO NOTHING';
  new_conflict_clause constant text := 'ON CONFLICT ON CONSTRAINT dispatch_location_decision_snapshots_dispatch_request_id_key DO NOTHING';
begin
  function_ddl := pg_get_functiondef(
    'public.dispatch_lpg_order(uuid,integer,text,text)'::regprocedure
  );

  if function_ddl ~* new_conflict_clause then
    return;
  end if;

  if function_ddl !~* old_conflict_pattern then
    raise exception
      'LPG dispatch conflict fix could not find the expected ambiguous ON CONFLICT clause; refusing to alter dispatch_lpg_order';
  end if;

  if (select count(*) from regexp_matches(function_ddl, old_conflict_pattern, 'gi')) <> 1 then
    raise exception
      'LPG dispatch conflict fix expected exactly one ambiguous ON CONFLICT clause; refusing to alter dispatch_lpg_order';
  end if;

  function_ddl := regexp_replace(
    function_ddl,
    old_conflict_pattern,
    new_conflict_clause,
    'i'
  );

  execute function_ddl;
end
$migration$;
