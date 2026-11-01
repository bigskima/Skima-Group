begin;

-- A missing workspace wallet is an empty-state condition, not a failed
-- financial-history read. The client also avoids making this RPC call without
-- a wallet ID; keep the RPC defensive for older clients and stale cached data.
do $migration$
declare
  fn text;
  patched text;
begin
  fn := pg_get_functiondef('public.read_wallet_activity(uuid,integer,integer)'::regprocedure);
  patched := regexp_replace(
    fn,
    'if target_wallet_id is null then[[:space:]]+raise exception ''target_wallet_id is required'';[[:space:]]+end if;',
    $replacement$if target_wallet_id is null then return jsonb_build_object('items','[]'::jsonb,'totalCount',0,'offset',resolved_offset,'limit',resolved_limit,'hasMore',false); end if;$replacement$,
    'g'
  );

  if patched = fn and position(
    'if target_wallet_id is null then return jsonb_build_object',
    fn
  ) = 0 then
    raise exception 'could not apply null-wallet activity fallback';
  end if;

  if patched <> fn then
    execute patched;
  end if;
end
$migration$;

notify pgrst,'reload schema';
commit;
