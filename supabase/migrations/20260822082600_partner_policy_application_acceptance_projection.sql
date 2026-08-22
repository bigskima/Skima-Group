-- Historical reconciliation marker.
-- Production briefly projected an account-level Partner policy acceptance into an application
-- inside submit_application at this migration version. The implementation was immediately
-- superseded by 20260822083011, which delegates the same behavior to the governed
-- link_current_policy_acceptance_to_application helper introduced in 20260822082537.
-- Keeping this tracked version preserves Supabase migration history without reintroducing
-- the superseded duplicate projection implementation on fresh environments.
select 1;
