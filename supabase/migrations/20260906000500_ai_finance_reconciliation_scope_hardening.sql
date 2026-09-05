begin;

-- Keep automated finance intelligence conservative.
-- Cancelled/failed requests can legitimately end before money is held, so the automated
-- reconciliation detector only evaluates lifecycle states where a completed money outcome is expected.

update public.ai_finance_reconciliation_rules
set config = jsonb_set(
      config,
      '{terminal_service_statuses}',
      '["completed","settled","refunded"]'::jsonb,
      true
    ),
    updated_at = timezone('utc', now())
where key = 'ai.finance.reconciliation.health';

-- Re-run the validation boundary against the hardened configuration.
update public.ai_finance_reconciliation_rules
set config = config,
    updated_at = updated_at
where key = 'ai.finance.reconciliation.health';

commit;
