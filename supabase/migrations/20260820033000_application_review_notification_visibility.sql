begin;

-- Application review notices are owned by the applicant's auth user. Older
-- gateway versions wrote `profile`, while RLS intentionally exposes personal
-- communications only when the recipient entity type is `user`.
update public.communication_messages
set recipient_entity_type = 'user'
where source = 'skima.application.review'
  and recipient_entity_type = 'profile'
  and recipient_entity_id is not null
  and purpose like 'application.%';

-- Keep application-review notices visible even while older deployed gateway
-- versions are being rolled forward. This is deliberately narrow: it changes
-- only SKIMA application-review messages and does not broaden the RLS policy.
create or replace function public.normalize_application_review_recipient()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.source = 'skima.application.review'
     and new.recipient_entity_type = 'profile'
     and new.recipient_entity_id is not null
     and new.purpose like 'application.%' then
    new.recipient_entity_type := 'user';
  end if;

  return new;
end;
$$;

drop trigger if exists communication_messages_normalize_application_review_recipient
  on public.communication_messages;

create trigger communication_messages_normalize_application_review_recipient
before insert or update of recipient_entity_type, source, purpose
on public.communication_messages
for each row
execute function public.normalize_application_review_recipient();

commit;
