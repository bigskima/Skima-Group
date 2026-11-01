begin;

-- Supplier receipts remain accepted evidence when available, but absence of a
-- receipt must not block SKIMA Managed refill recording or cylinder return.
do $migration$
declare
  function_ddl text;
  old_setting constant text := 'requires_receipt:=coalesce((config->>''require_supplier_receipt'')::boolean,true);';
  new_setting constant text := 'requires_receipt:=false;';
  old_guard constant text := E'  if requires_receipt and target_receipt_media_asset_id is null then\n    raise exception using errcode=''22023'',message=''supplier receipt evidence is required for SKIMA internal refill'';\n  end if;';
  matches integer;
begin
  function_ddl:=pg_get_functiondef(
    'public.confirm_lpg_internal_refill(uuid,numeric,text,numeric,text,text,text,numeric,numeric,uuid,jsonb,uuid[],text,jsonb,text)'::regprocedure
  );

  if position(new_setting in function_ddl)>0
    and position('supplier receipt evidence is required for SKIMA internal refill' in function_ddl)=0 then
    return;
  end if;

  select count(*) into matches
  from regexp_matches(function_ddl, 'requires_receipt:=coalesce\\(\\(config->>''require_supplier_receipt''\\)::boolean,true\\);', 'gi');

  if matches<>1 or position(old_guard in function_ddl)=0 then
    raise exception 'Expected exactly one supplier receipt requirement in confirm_lpg_internal_refill; refusing to alter unrelated refill validations';
  end if;

  function_ddl:=replace(function_ddl,old_setting,new_setting);
  function_ddl:=replace(function_ddl,old_guard,
    E'  -- Receipt attachment is optional. When supplied, the media asset is still validated below.\n');

  if position('supplier receipt evidence is required for SKIMA internal refill' in function_ddl)>0 then
    raise exception 'Supplier receipt requirement remains in internal refill function';
  end if;

  execute function_ddl;
end
$migration$;

do $policy$
declare
  affected integer;
begin
  update public.lpg_operation_policies
  set policy=jsonb_set(coalesce(policy,'{}'::jsonb),'{require_supplier_receipt}','false'::jsonb,true),
      metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'lastReason','Supplier receipt is optional supporting evidence; manual/physical receipt handling must not block SKIMA Managed refill recording.',
        'lastChangedAt',timezone('utc',now()),
        'receiptRequirement','optional',
        'receiptOptionalMigration','20261101105200'
      ),
      updated_at=timezone('utc',now())
  where key='lpg.fulfillment.launch_assurance'
    and status='active';

  get diagnostics affected=row_count;
  if affected<>1 then
    raise exception 'Expected exactly one active SKIMA fulfilment launch policy; updated % rows',affected;
  end if;
end
$policy$;

notify pgrst,'reload schema';
commit;