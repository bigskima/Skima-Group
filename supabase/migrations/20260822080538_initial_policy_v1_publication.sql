-- Reconciliation marker for the initial immutable v1.0 Customer and Partner policy publication.
--
-- The canonical full policy bodies are governed runtime content, not application source code.
-- Production published both version 1.0 documents through the policy runtime under this
-- tracked migration version. Fresh environments intentionally remain on the canonical-source
-- fallback until an authorized administrator imports and publishes the complete policy text.
-- This prevents a partial or stale legal document from being silently embedded during deploy.
--
-- The live production versions are immutable and are not rewritten by this reconciliation file.
select 1;
