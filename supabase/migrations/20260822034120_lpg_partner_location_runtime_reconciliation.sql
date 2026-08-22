drop trigger if exists application_records_guard_lpg_partner_location_approval on public.application_records;
drop function if exists public.guard_lpg_partner_location_before_approval();
drop function if exists public.read_application_location_reviews();
drop function if exists public.review_application_location(uuid,text,text,text,jsonb);

-- The canonical application-location review runtime is defined by the geography foundation:
-- read_partner_application_location_reviews(),
-- review_application_location(application_id, application_version_id, ...), and
-- application_records_require_verified_lpg_partner_location.
-- Keep the driver payload preservation trigger introduced later because the legacy
-- application form still writes identity/contact/licence fields independently.

do $$
begin
  if not exists (
    select 1
    from pg_trigger trigger_record
    join pg_class table_record on table_record.oid = trigger_record.tgrelid
    join pg_namespace schema_record on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'public'
      and table_record.relname = 'application_records'
      and trigger_record.tgname = 'application_records_require_verified_lpg_partner_location'
      and not trigger_record.tgisinternal
  ) then
    raise exception 'canonical LPG partner location approval guard is missing';
  end if;

  if to_regprocedure('public.read_partner_application_location_reviews()') is null then
    raise exception 'canonical partner location review reader is missing';
  end if;

  if to_regprocedure('public.review_application_location(uuid,uuid,text,text,text,jsonb)') is null then
    raise exception 'canonical partner location review action is missing';
  end if;
end;
$$;
