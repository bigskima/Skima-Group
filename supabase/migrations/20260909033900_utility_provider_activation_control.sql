begin;

set local lock_timeout='10s';
set local statement_timeout='0';

create or replace function public.set_utility_provider_status(
  target_provider_key text,
  target_status text
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  provider_record public.provider_adapters%rowtype;
begin
  if not (
    public.has_permission('platform.billing.manage',null)
    or public.is_platform_super_admin()
  ) then
    raise exception using errcode='42501',
      message='bill service management permission is required';
  end if;

  if target_status not in ('active','inactive','disabled') then
    raise exception 'utility provider status must be active, inactive or disabled';
  end if;

  select *
  into provider_record
  from public.provider_adapters
  where provider_kind='utility'
    and key=target_provider_key
  for update;

  if not found then raise exception 'utility provider was not found'; end if;

  if target_status='active' then
    if provider_record.secret_ref is null then
      raise exception 'utility provider cannot activate without an Edge secret reference';
    end if;
    if coalesce((provider_record.config->>'runtimeInstalled')::boolean,false) is not true then
      raise exception 'utility provider cannot activate without an installed SKIMA runtime adapter';
    end if;
    if coalesce((provider_record.config->>'connectionHealthy')::boolean,false) is not true then
      raise exception 'test the utility provider API connection successfully before activation';
    end if;
    if coalesce((provider_record.config->>'runtimeReady')::boolean,false) is not true then
      raise exception 'complete a successful real-money provider test before activation';
    end if;
  end if;

  update public.provider_adapters
  set status=target_status,
      updated_at=timezone('utc',now())
  where id=provider_record.id;

  insert into public.audit_logs(
    actor_user_id,action,entity_type,entity_id,after_state,metadata
  )
  values(
    auth.uid(),'utility.provider.status_changed','provider_adapter',provider_record.id,
    jsonb_build_object(
      'providerKey',provider_record.key,
      'status',target_status
    ),
    jsonb_build_object('source','skima.admin.utility_billing')
  );

  return provider_record.id;
end;
$$;

revoke all on function public.set_utility_provider_status(text,text)
from public,anon;
grant execute on function public.set_utility_provider_status(text,text)
to authenticated,service_role;

notify pgrst,'reload schema';

commit;