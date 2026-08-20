begin;

create index if not exists communication_messages_recipient_timeline_idx
  on public.communication_messages (recipient_entity_type, recipient_entity_id, created_at desc);

create index if not exists communication_messages_application_review_timeline_idx
  on public.communication_messages ((metadata ->> 'applicationId'), created_at desc)
  where source = 'skima.application.review';

commit;
