begin;

create table public.app_startup_branding_versions(
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  status text not null check(status in('active','superseded')),
  enabled boolean not null default true,
  background_color text not null check(background_color~'^#[0-9A-Fa-f]{6}$'),
  logo_light_url text check(logo_light_url is null or logo_light_url~'^https://'),
  logo_dark_url text check(logo_dark_url is null or logo_dark_url~'^https://'),
  background_image_url text check(background_image_url is null or background_image_url~'^https://'),
  logo_size integer not null check(logo_size between 48 and 320),
  logo_placement text not null check(logo_placement in('top','center','bottom')),
  tagline text check(tagline is null or char_length(tagline)<=120),
  display_duration_ms integer not null check(display_duration_ms between 250 and 5000),
  change_reason text not null,
  idempotency_key text not null unique,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc',now())
);
create unique index app_startup_branding_one_active on public.app_startup_branding_versions(status) where status='active';
alter table public.app_startup_branding_versions enable row level security;
create trigger audit_app_startup_branding_versions after insert or update or delete on public.app_startup_branding_versions for each row execute function public.record_table_audit();
revoke all on public.app_startup_branding_versions from public,anon,authenticated;
grant all on public.app_startup_branding_versions to service_role;

create or replace function public.read_active_startup_branding() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select jsonb_build_object(
    'version',version,'enabled',enabled,'backgroundColor',background_color,
    'logoLightUrl',logo_light_url,'logoDarkUrl',logo_dark_url,
    'backgroundImageUrl',background_image_url,'logoSize',logo_size,
    'logoPlacement',logo_placement,'tagline',tagline,
    'displayDurationMs',display_duration_ms,'updatedAt',created_at
  ) from public.app_startup_branding_versions where status='active' order by version desc limit 1),
  jsonb_build_object('version',0,'enabled',true,'backgroundColor','#0B1510','logoLightUrl',null,'logoDarkUrl',null,'backgroundImageUrl',null,'logoSize',180,'logoPlacement','center','tagline','Move with confidence.','displayDurationMs',900,'updatedAt',null));
$$;

create or replace function public.configure_startup_branding(
  target_enabled boolean,target_background_color text,target_logo_light_url text,
  target_logo_dark_url text,target_background_image_url text,target_logo_size integer,
  target_logo_placement text,target_tagline text,target_display_duration_ms integer,
  target_change_reason text,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare next_version integer; existing jsonb;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' and not public.is_platform_super_admin() then raise exception using errcode='42501',message='only an active Super Admin can change startup branding'; end if;
  if target_background_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'choose a valid six-digit background colour'; end if;
  if target_logo_size not between 48 and 320 then raise exception 'logo size must be between 48 and 320'; end if;
  if target_logo_placement not in('top','center','bottom') then raise exception 'choose a supported logo placement'; end if;
  if target_display_duration_ms not between 250 and 5000 then raise exception 'display duration must be between 0.25 and 5 seconds'; end if;
  if char_length(coalesce(target_tagline,''))>120 then raise exception 'tagline must be 120 characters or fewer'; end if;
  if nullif(btrim(target_change_reason),'') is null or nullif(btrim(target_idempotency_key),'') is null then raise exception 'a change note and request identity are required'; end if;
  select public.read_active_startup_branding() into existing from public.app_startup_branding_versions where idempotency_key=target_idempotency_key limit 1;
  if existing is not null then return existing; end if;
  next_version:=(select coalesce(max(version),0)+1 from public.app_startup_branding_versions);
  update public.app_startup_branding_versions set status='superseded' where status='active';
  insert into public.app_startup_branding_versions(version,status,enabled,background_color,logo_light_url,logo_dark_url,background_image_url,logo_size,logo_placement,tagline,display_duration_ms,change_reason,idempotency_key)
  values(next_version,'active',target_enabled,target_background_color,nullif(target_logo_light_url,''),nullif(target_logo_dark_url,''),nullif(target_background_image_url,''),target_logo_size,target_logo_placement,nullif(btrim(target_tagline),''),target_display_duration_ms,btrim(target_change_reason),target_idempotency_key);
  existing:=public.read_active_startup_branding();
  return existing;
end $$;

revoke all on function public.read_active_startup_branding() from public;
grant execute on function public.read_active_startup_branding() to anon,authenticated,service_role;
revoke all on function public.configure_startup_branding(boolean,text,text,text,text,integer,text,text,integer,text,text) from public,anon;
grant execute on function public.configure_startup_branding(boolean,text,text,text,text,integer,text,text,integer,text,text) to authenticated,service_role;

commit;
