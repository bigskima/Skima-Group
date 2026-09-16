begin;

create or replace function public.pay_lpg_managed_driver_batch_to_wallet(
  target_payments jsonb,
  target_idempotency_key text,
  target_note text default null,
  target_currency_code text default 'NGN',
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_batch_id uuid:=gen_random_uuid();
  existing_batch public.lpg_internal_driver_payout_batches%rowtype;
  v_batch_reference text;
  payment jsonb;
  driver_id uuid;
  payment_amount numeric(28,8);
  payment_result jsonb;
  payout_id uuid;
  payout_ids uuid[]:='{}'::uuid[];
  seen_driver_ids uuid[]:='{}'::uuid[];
  total_amount numeric(28,8):=0;
  payout_count integer:=0;
begin
  if auth.role()<>'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.financial.manage',null) then
    raise exception using errcode='42501',message='financial management permission is required to pay managed Drivers';
  end if;
  if coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='idempotency key is required';
  end if;
  if target_payments is null or jsonb_typeof(target_payments)<>'array' or jsonb_array_length(target_payments)<1 then
    raise exception using errcode='22023',message='Choose at least one Driver payment';
  end if;
  if jsonb_array_length(target_payments)>200 then
    raise exception using errcode='22023',message='A batch can contain at most 200 Driver payments';
  end if;
  if target_currency_code is null or target_currency_code !~ '^[A-Z0-9]{3,12}$' then
    raise exception using errcode='22023',message='valid currency is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='metadata must be an object';
  end if;

  select * into existing_batch
  from public.lpg_internal_driver_payout_batches batch
  where batch.source='lpg.managed_driver_batch_payout' and batch.idempotency_key=target_idempotency_key;
  if found then
    return jsonb_build_object(
      'batchId',existing_batch.id,
      'batchReference',existing_batch.batch_reference,
      'totalAmount',existing_batch.total_amount,
      'payoutCount',existing_batch.payout_count,
      'currencyCode',existing_batch.currency_code,
      'status',existing_batch.status
    );
  end if;

  for payment in select value from jsonb_array_elements(target_payments)
  loop
    if jsonb_typeof(payment)<>'object' then
      raise exception using errcode='22023',message='Each Driver payment must be an object';
    end if;
    begin
      driver_id:=(payment->>'driverProfileId')::uuid;
      payment_amount:=(payment->>'amount')::numeric;
    exception when others then
      raise exception using errcode='22023',message='Each Driver payment needs a valid Driver and amount';
    end;
    if driver_id is null or payment_amount is null or payment_amount<=0 then
      raise exception using errcode='22023',message='Each Driver payment amount must be greater than zero';
    end if;
    if driver_id=any(seen_driver_ids) then
      raise exception using errcode='22023',message='A Driver can only appear once in one batch';
    end if;
    seen_driver_ids:=array_append(seen_driver_ids,driver_id);

    payment_result:=public.pay_lpg_managed_driver_to_wallet(
      driver_id,
      payment_amount,
      target_idempotency_key||':driver:'||driver_id::text,
      nullif(btrim(coalesce(target_note,'')),''),
      target_currency_code,
      target_metadata||jsonb_build_object('batchId',v_batch_id,'batchPayment',true)
    );
    payout_id:=(payment_result->>'payoutId')::uuid;
    payout_ids:=array_append(payout_ids,payout_id);
    total_amount:=total_amount+payment_amount;
    payout_count:=payout_count+1;
  end loop;

  v_batch_reference:='MDB-'||upper(substr(replace(v_batch_id::text,'-',''),1,12));
  insert into public.lpg_internal_driver_payout_batches(
    id,currency_code,total_amount,payout_count,status,batch_reference,paid_by,paid_at,note,source,idempotency_key,metadata
  ) values(
    v_batch_id,target_currency_code,total_amount,payout_count,'posted',v_batch_reference,auth.uid(),timezone('utc',now()),
    nullif(btrim(coalesce(target_note,'')),''),'lpg.managed_driver_batch_payout',target_idempotency_key,
    target_metadata||jsonb_build_object('payoutIds',to_jsonb(payout_ids))
  );

  update public.lpg_internal_driver_payouts payout
  set batch_id=v_batch_id,
      metadata=payout.metadata||jsonb_build_object('batchReference',v_batch_reference)
  where payout.id=any(payout_ids);

  return jsonb_build_object(
    'batchId',v_batch_id,
    'batchReference',v_batch_reference,
    'totalAmount',total_amount,
    'payoutCount',payout_count,
    'currencyCode',target_currency_code,
    'status','posted'
  );
end
$$;

revoke all on function public.pay_lpg_managed_driver_batch_to_wallet(jsonb,text,text,text,jsonb) from public,anon;
grant execute on function public.pay_lpg_managed_driver_batch_to_wallet(jsonb,text,text,text,jsonb) to authenticated,service_role;

commit;
