drop trigger if exists application_records_guard_lpg_partner_location_approval on public.application_records;
drop function if exists public.guard_lpg_partner_location_before_approval();

-- Retire the weaker review overload so all location decisions use the exact
-- application/version-aware command that also writes application_location_review_events.
drop function if exists public.review_application_location(uuid,text,text,text,jsonb);

-- Retire the duplicate read surface; the canonical review projection includes
-- applications with missing evidence as well as those already mirrored.
drop function if exists public.read_application_location_reviews();