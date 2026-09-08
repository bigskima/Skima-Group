begin;

-- A configured verification route must not keep presenting itself as available
-- when the provider account has already rejected live session creation because
-- its credit balance is exhausted. Pause all active routes for the affected
-- provider so partner onboarding immediately falls back to permitted evidence.
update public.verification_provider_routes route
set
  status = 'paused',
  config = coalesce(route.config, '{}'::jsonb) || jsonb_build_object(
    'runtimePauseReason', 'provider_credits_exhausted',
    'runtimePausedAt', timezone('utc', now())
  ),
  updated_at = timezone('utc', now())
where route.status = 'active'
  and exists (
    select 1
    from public.provider_execution_logs execution
    where execution.provider_adapter_id = route.provider_adapter_id
      and execution.provider_kind = 'verification'
      and execution.operation_key = 'verification.session.create'
      and execution.status = 'failed'
      and execution.created_at >= timezone('utc', now()) - interval '24 hours'
      and (
        lower(coalesce(execution.error_message, '')) like '%not enough credits%'
        or lower(coalesce(execution.error_message, '')) like '%insufficient credits%'
        or (
          lower(coalesce(execution.error_message, '')) like '%credit%'
          and lower(coalesce(execution.error_message, '')) like '%top up%'
        )
      )
  );

notify pgrst, 'reload schema';

commit;
