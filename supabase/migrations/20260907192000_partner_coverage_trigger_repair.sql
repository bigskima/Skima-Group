begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Partner onboarding coverage is intentionally separate from customer LPG
-- ordering coverage. A Driver or Station may apply from an unlaunched customer
-- area and submit a governed candidate radius for Admin review.
insert into public.configuration_entries (
  namespace,
  key,
  scope_type,
  scope_id,
  value,
  is_secret,
  status,
  version,
  effective_from
)
select
  'lpg.partner_onboarding',
  'universal_candidate_coverage',
  'global',
  null,
  jsonb_build_object(
    'enabled', true,
    'driverEnabled', true,
    'stationEnabled', true,
    'radiusMeters', 5000,
    'minimumRadiusMeters', 500,
    'maximumRadiusMeters', 50000,
    'source', 'partner_coverage_runtime_repair'
  ),
  false,
  'active',
  coalesce((
    select max(entry.version) + 1
    from public.configuration_entries entry
    where entry.namespace = 'lpg.partner_onboarding'
      and entry.key = 'universal_candidate_coverage'
      and entry.scope_type = 'global'
      and entry.scope_id is null
  ), 1),
  timezone('utc', now())
where not exists (
  select 1
  from public.configuration_entries entry
  where entry.namespace = 'lpg.partner_onboarding'
    and entry.key = 'universal_candidate_coverage'
    and entry.scope_type = 'global'
    and entry.scope_id is null
    and entry.status = 'active'
    and entry.is_secret = false
    and (entry.effective_from is null or entry.effective_from <= timezone('utc', now()))
    and (entry.effective_until is null or entry.effective_until > timezone('utc', now()))
);

-- The projector was originally installed before the later resilient function
-- replacement. Reinstalling the trigger is idempotent and protects restored or
-- partially migrated environments where the function exists but the trigger
-- was not carried forward.
drop trigger if exists sync_universal_application_geography
  on public.application_versions;

create trigger sync_universal_application_geography
after insert or update of payload on public.application_versions
for each row
execute function public.sync_universal_application_location_and_coverage();

comment on trigger sync_universal_application_geography
on public.application_versions is
  'Projects Driver/Station application coverage requests without requiring customer LPG ordering to be enabled at the applicant location.';

commit;
