begin;

-- Station price authority follows the same branch-scoped permission exposed by
-- the mobile workspace. This keeps the platform engine business-agnostic while
-- allowing an approved station operator to manage only its own branch price.
create or replace function public.can_manage_delegated_lpg_station_price(target_station_branch_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.lpg_station_branches station
    where station.id=target_station_branch_id
      and station.approval_status='approved'
      and station.compliance_status='approved'
      and (
        auth.role()='service_role'
        or public.can_manage_lpg_operations()
        or public.has_permission_for_branch('business.partner_price.manage',station.organization_id,station.branch_id)
        or public.can_operate_lpg_station_branch(station.id,'lpg.stations.manage')
      )
  );
$$;

-- Revenue managers retain the explicit permission path, while an active Super
-- Admin remains authoritative even if the UI session role label differs.
create or replace function public.set_platform_fee_amount(target_fee_key text,target_amount numeric,target_reason text,target_idempotency_key text,target_currency_code text default 'NGN') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare control record; current_version public.financial_policy_versions%rowtype; new_id uuid; next_version integer; now_at timestamptz:=timezone('utc',now()); next_configuration jsonb;
begin
  if auth.role()<>'service_role' and not public.is_platform_super_admin() and not public.has_permission('platform.revenue.manage',null) then raise exception using errcode='42501',message='platform revenue management permission is required'; end if;
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

create or replace function public.decline_organization_invitation(target_invitation_id uuid,target_idempotency_key text,target_metadata jsonb default '{}') returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare invitation_record public.organization_invitations%rowtype; actor_email text;
begin
  if auth.uid() is null then raise exception 'authenticated user context is required'; end if;
  select email into actor_email from auth.users where id=auth.uid();
  select * into invitation_record from public.organization_invitations where id=target_invitation_id for update;
  if invitation_record.id is null then raise exception 'invitation was not found'; end if;
  if invitation_record.status='declined' then return invitation_record.id; end if;
  if invitation_record.status<>'pending' or lower(invitation_record.invited_email)<>lower(actor_email) then raise exception 'only the invited user can decline a pending invitation'; end if;
  update public.organization_invitations set status='declined',metadata=metadata||coalesce(target_metadata,'{}'),updated_at=timezone('utc',now()) where id=target_invitation_id;
  perform public.record_organization_staff_event(invitation_record.organization_id,'event.organization.staff.declined',target_idempotency_key||':event',auth.uid(),target_invitation_id,invitation_record.role_id,invitation_record.branch_id,'pending','declined',coalesce(target_metadata,'{}'));
  return target_invitation_id;
end $$;
revoke all on function public.decline_organization_invitation(uuid,text,jsonb) from public,anon;
grant execute on function public.decline_organization_invitation(uuid,text,jsonb) to authenticated,service_role;

create or replace function public.notify_organization_invitation_in_app() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.invited_user_id is not null and new.status='pending' then
    insert into public.communication_messages(channel,purpose,recipient_entity_type,recipient_entity_id,recipient_address,status,payload,source,idempotency_key,metadata,created_by)
    values('in_app','organization.staff.invitation','user',new.invited_user_id,null,'queued',jsonb_build_object('title','Station team invitation','body','You have been invited to join a station team.','invitationId',new.id,'organizationId',new.organization_id),'skima.organization.invitation','organization-invitation:'||new.id,'{}',new.invited_by)
    on conflict(source,idempotency_key) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists organization_invitation_in_app_notice on public.organization_invitations;
create trigger organization_invitation_in_app_notice after insert or update of invited_user_id,status on public.organization_invitations for each row execute function public.notify_organization_invitation_in_app();

commit;
