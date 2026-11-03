begin;

insert into public.document_requirement_sets (
  key, display_name, subject_category, status, metadata
) values (
  'documents.logistics.company.onboarding',
  'SKIMA Logistics Company Application Evidence',
  'business',
  'active',
  jsonb_build_object(
    'configurable', true,
    'product_module', 'logistics_network',
    'registration_optional', true,
    'review_authority', 'platform_admin'
  )
)
on conflict (key) do update
set display_name = excluded.display_name,
    subject_category = excluded.subject_category,
    status = 'active',
    metadata = public.document_requirement_sets.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

with requirement_set as (
  select id
  from public.document_requirement_sets
  where key = 'documents.logistics.company.onboarding'
)
insert into public.document_requirements (
  requirement_set_id, key, display_name, description, is_required,
  review_required, min_count, max_count, allowed_content_types,
  max_byte_size, status, metadata
)
select
  requirement_set.id,
  requirement.key,
  requirement.display_name,
  requirement.description,
  false,
  true,
  0,
  5,
  array['application/pdf','image/jpeg','image/png','image/webp']::text[],
  52428800,
  'active',
  jsonb_build_object(
    'configurable', true,
    'optional_for_unregistered_company', true,
    'privacy_classification', 'PRIVATE_VERIFICATION'
  )
from requirement_set
cross join (values
  ('logistics.company.registration', 'Business registration evidence (optional)', 'CAC certificate or other registration evidence. Leave this empty when the company is not registered.'),
  ('logistics.company.owner-identity', 'Owner or authorised representative identity', 'A valid identity document for the person applying on behalf of the company.'),
  ('logistics.company.proof-of-address', 'Business or operating address evidence', 'A document or bill that helps SKIMA verify the company operating address.')
) as requirement(key, display_name, description)
on conflict (requirement_set_id, key) do update
set display_name = excluded.display_name,
    description = excluded.description,
    is_required = false,
    review_required = true,
    min_count = 0,
    max_count = 5,
    allowed_content_types = excluded.allowed_content_types,
    max_byte_size = excluded.max_byte_size,
    status = 'active',
    metadata = public.document_requirements.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

insert into public.application_type_definitions (
  key, display_name, application_category, workflow_key,
  document_requirement_set_id, review_policy, activation_policy,
  status, metadata
)
select
  'application.logistics.company',
  'SKIMA Logistics Company Application',
  'business',
  'workflow.application.review.default',
  requirement_set.id,
  jsonb_build_object(
    'manual_review', true,
    'review_authority', 'platform_admin',
    'approval_required_before_matching', true
  ),
  jsonb_build_object(
    'mode', 'manual',
    'approved_by_platform_admin', true
  ),
  'active',
  jsonb_build_object(
    'product_module', 'logistics_network',
    'registration_optional', true,
    'submission_required_fields', jsonb_build_array(),
    'registration_document_optional', true
  )
from public.document_requirement_sets requirement_set
where requirement_set.key = 'documents.logistics.company.onboarding'
on conflict (key) do update
set display_name = excluded.display_name,
    application_category = excluded.application_category,
    workflow_key = excluded.workflow_key,
    document_requirement_set_id = excluded.document_requirement_set_id,
    review_policy = excluded.review_policy,
    activation_policy = excluded.activation_policy,
    status = 'active',
    metadata = public.application_type_definitions.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

commit;
