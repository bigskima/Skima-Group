begin;

create table public.platform_fee_controls(
  key text primary key check(key~'^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  description text not null,
  unit_label text not null,
  policy_key text not null references public.financial_policy_definitions(key) on delete restrict,
  configuration_path text[] not null check(cardinality(configuration_path)>0),
  status text not null default 'active' check(status in('active','retired')),
  display_order integer not null default 100,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now())
);
alter table public.platform_fee_controls enable row level security;
revoke all on public.platform_fee_controls from public,anon,authenticated;
grant select on public.platform_fee_controls to authenticated;
grant all on public.platform_fee_controls to service_role;
create policy platform_fee_controls_admin_read on public.platform_fee_controls for select to authenticated using(public.is_platform_super_admin() or public.has_permission('platform.revenue.read',null));
create trigger audit_platform_fee_controls after insert or update or delete on public.platform_fee_controls for each row execute function public.record_table_audit();

insert into public.platform_fee_controls(key,display_name,description,unit_label,policy_key,configuration_path,display_order) values
('lpg_markup_per_kg','Refill service fee','SKIMA fee charged for each kilogram in a refill.','per kg','pricing.lpg.platform_markup_per_kg',array['amount_per_kg'],10),
('withdrawal_fee','Withdrawal fee','Fixed SKIMA fee charged when money is withdrawn.','per withdrawal','fees.withdrawal.default',array['fixed_amount'],20),
('deposit_fee','Deposit fee','Fixed SKIMA fee charged when money is deposited.','per deposit','fees.deposit.default',array['fixed_amount'],30),
('settlement_fee','Settlement fee','Fixed SKIMA fee retained during beneficiary settlement.','per settlement','settlement.lpg.beneficiaries',array['locked_platform_fee_amount'],40);

create or replace function public.read_platform_fee_controls(target_currency_code text default 'NGN') returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'key',control.key,'displayName',control.display_name,'description',control.description,'unitLabel',control.unit_label,
    'currencyCode',upper(target_currency_code),'amount',coalesce(nullif(version.configuration#>>control.configuration_path,'')::numeric,0),
    'policyVersionId',version.id,'policyVersion',coalesce(version.version,0),'effectiveFrom',version.effective_from
  ) order by control.display_order),'[]'::jsonb)
  from public.platform_fee_controls control
  join public.financial_policy_definitions definition on definition.key=control.policy_key and definition.status='active'
  left join lateral(
    select candidate.* from public.financial_policy_versions candidate
    where candidate.policy_definition_id=definition.id and candidate.currency_code=upper(target_currency_code)
      and candidate.lifecycle_status='active' and candidate.effective_from<=timezone('utc',now())
      and (candidate.effective_until is null or candidate.effective_until>timezone('utc',now()))
    order by candidate.priority desc,candidate.effective_from desc,candidate.version desc limit 1
  ) version on true
  where control.status='active' and (public.is_platform_super_admin() or public.has_permission('platform.revenue.read',null));
$$;

create or replace function public.set_platform_fee_amount(target_fee_key text,target_amount numeric,target_reason text,target_idempotency_key text,target_currency_code text default 'NGN') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare control record; definition record; current_version public.financial_policy_versions%rowtype; new_id uuid; next_version integer; now_at timestamptz:=timezone('utc',now()); next_configuration jsonb;
begin
  if auth.role()<>'service_role' and not public.is_platform_super_admin() then raise exception using errcode='42501',message='only an active Super Admin can change platform fees'; end if;
  if target_amount is null or target_amount<0 then raise exception using errcode='22023',message='fee amount must be zero or greater'; end if;
  if nullif(btrim(target_reason),'') is null or nullif(btrim(target_idempotency_key),'') is null then raise exception using errcode='22023',message='reason and idempotency key are required'; end if;
  select c.*,d.id definition_id,d.policy_family into control from public.platform_fee_controls c join public.financial_policy_definitions d on d.key=c.policy_key where c.key=target_fee_key and c.status='active' and d.status='active';
  if not found then raise exception using errcode='P0002',message='configured platform fee was not found'; end if;
  select * into current_version from public.financial_policy_versions where policy_definition_id=control.definition_id and currency_code=upper(target_currency_code) and lifecycle_status='active' and effective_from<=now_at and (effective_until is null or effective_until>now_at) order by priority desc,effective_from desc,version desc limit 1 for update;
  if current_version.id is null then raise exception using errcode='23514',message='platform fee has no active policy version to update safely'; end if;
  if coalesce(nullif(current_version.configuration#>>control.configuration_path,'')::numeric,0)=target_amount then return jsonb_build_object('changed',false,'feeKey',control.key,'amount',target_amount,'currencyCode',upper(target_currency_code),'policyVersionId',current_version.id,'effectiveFrom',current_version.effective_from); end if;
  if exists(select 1 from public.financial_policy_events where idempotency_key=target_idempotency_key) then return (select new_state from public.financial_policy_events where idempotency_key=target_idempotency_key order by created_at desc limit 1); end if;
  next_configuration:=jsonb_set(current_version.configuration,control.configuration_path,to_jsonb(target_amount),true);
  next_version:=(select coalesce(max(version),0)+1 from public.financial_policy_versions where policy_definition_id=control.definition_id);
  update public.financial_policy_versions set lifecycle_status='superseded',effective_until=now_at,updated_at=now_at where id=current_version.id;
  insert into public.financial_policy_versions(policy_definition_id,version,lifecycle_status,organization_id,module_id,service_key,geography_type,geography_key,currency_code,priority,configuration,effective_from,effective_until,change_reason,validation_snapshot,based_on_version_id,supersedes_version_id,submitted_by,submitted_at,approved_by,approved_at,activated_by,activated_at,created_by)
  values(control.definition_id,next_version,'active',current_version.organization_id,current_version.module_id,current_version.service_key,current_version.geography_type,current_version.geography_key,upper(target_currency_code),current_version.priority,next_configuration,now_at,null,btrim(target_reason),public.validate_financial_policy_configuration(control.policy_family,next_configuration),current_version.id,current_version.id,auth.uid(),now_at,auth.uid(),now_at,auth.uid(),now_at,auth.uid()) returning id into new_id;
  insert into public.financial_policy_events(policy_version_id,event_type,previous_state,new_state,reason,idempotency_key) values(new_id,'activated',to_jsonb(current_version),jsonb_build_object('changed',true,'feeKey',control.key,'amount',target_amount,'currencyCode',upper(target_currency_code),'policyVersionId',new_id,'effectiveFrom',now_at),btrim(target_reason),target_idempotency_key);
  return jsonb_build_object('changed',true,'feeKey',control.key,'amount',target_amount,'currencyCode',upper(target_currency_code),'policyVersionId',new_id,'effectiveFrom',now_at);
end $$;

revoke all on function public.read_platform_fee_controls(text) from public,anon;
grant execute on function public.read_platform_fee_controls(text) to authenticated,service_role;
revoke all on function public.set_platform_fee_amount(text,numeric,text,text,text) from public,anon;
grant execute on function public.set_platform_fee_amount(text,numeric,text,text,text) to authenticated,service_role;
commit;
