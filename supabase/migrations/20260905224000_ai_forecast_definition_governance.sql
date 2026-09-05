begin;

-- Align table grants with the existing RLS management policy.
-- Only callers with platform.ai.manage / Super Admin pass the policy; stations retain read-only
-- access to their authorized forecast snapshots.

grant select, insert, update, delete
on public.ai_forecast_definitions
to authenticated;

revoke insert, update, delete
on public.ai_forecast_snapshots
from authenticated;

commit;
