begin;

create table if not exists public.skima_whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  whatsapp_wa_id text not null unique,
  profile_id uuid references public.profiles(id) on delete set null,
  link_status text not null default 'unlinked'
    check (link_status in ('unlinked', 'pending', 'linked', 'blocked')),
  linked_at timestamptz,
  last_inbound_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check ((link_status = 'linked') = (profile_id is not null))
);

create table if not exists public.skima_whatsapp_link_challenges (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  code_hash text not null unique,
  attempt_count integer not null default 0 check (attempt_count >= 0 and attempt_count <= 5),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists skima_whatsapp_link_challenges_profile_idx
  on public.skima_whatsapp_link_challenges(profile_id, expires_at desc)
  where consumed_at is null;

create or replace function public.issue_skima_whatsapp_link_code()
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $
declare
  actor_id uuid := auth.uid();
  raw_code text;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'authenticated customer required';
  end if;

  if not exists (
    select 1 from public.profiles profile
    where profile.id = actor_id and profile.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'active customer profile required';
  end if;

  update public.skima_whatsapp_link_challenges
  set consumed_at = timezone('utc', now())
  where profile_id = actor_id
    and consumed_at is null;

  raw_code := upper(encode(extensions.gen_random_bytes(8), 'hex'));

  insert into public.skima_whatsapp_link_challenges (
    profile_id, code_hash, expires_at
  ) values (
    actor_id,
    encode(extensions.digest(raw_code, 'sha256'), 'hex'),
    timezone('utc', now()) + interval '10 minutes'
  );

  return raw_code;
end;
$;

create or replace function public.consume_skima_whatsapp_link_code(
  target_code text,
  target_whatsapp_wa_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $
declare
  challenge_record public.skima_whatsapp_link_challenges%rowtype;
  contact_record public.skima_whatsapp_contacts%rowtype;
  normalized_code text := upper(btrim(coalesce(target_code, '')));
  normalized_wa_id text := btrim(coalesce(target_whatsapp_wa_id, ''));
begin
  if normalized_code !~ '^[A-F0-9]{16}
  on public.skima_whatsapp_contacts(profile_id)
  where profile_id is not null;

create table if not exists public.skima_whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.skima_whatsapp_contacts(id) on delete cascade,
  state_key text not null default 'menu'
    check (state_key ~ '^[a-z][a-z0-9_.:-]{1,100}$'),
  state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(state) = 'object'),
  status text not null default 'active'
    check (status in ('active', 'paused', 'closed')),
  last_message_at timestamptz,
  expires_at timestamptz not null default (timezone('utc', now()) + interval '24 hours'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (contact_id)
);

create table if not exists public.skima_whatsapp_events (
  id uuid primary key default gen_random_uuid(),
  provider_message_id text not null unique,
  contact_id uuid references public.skima_whatsapp_contacts(id) on delete set null,
  event_type text not null default 'message'
    check (event_type in ('message', 'status', 'unsupported')),
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processing', 'processed', 'failed', 'ignored')),
  inbound_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(inbound_payload) = 'object'),
  error_message text,
  received_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz
);

create index if not exists skima_whatsapp_events_status_received_idx
  on public.skima_whatsapp_events(processing_status, received_at);

drop trigger if exists skima_whatsapp_contacts_set_updated_at on public.skima_whatsapp_contacts;
create trigger skima_whatsapp_contacts_set_updated_at
  before update on public.skima_whatsapp_contacts
  for each row execute function public.set_updated_at();

drop trigger if exists skima_whatsapp_conversations_set_updated_at on public.skima_whatsapp_conversations;
create trigger skima_whatsapp_conversations_set_updated_at
  before update on public.skima_whatsapp_conversations
  for each row execute function public.set_updated_at();

alter table public.skima_whatsapp_contacts enable row level security;
alter table public.skima_whatsapp_conversations enable row level security;
alter table public.skima_whatsapp_events enable row level security;
alter table public.skima_whatsapp_link_challenges enable row level security;

revoke all on public.skima_whatsapp_contacts from anon, authenticated;
revoke all on public.skima_whatsapp_conversations from anon, authenticated;
revoke all on public.skima_whatsapp_events from anon, authenticated;
revoke all on public.skima_whatsapp_link_challenges from anon, authenticated;

grant all on public.skima_whatsapp_contacts to service_role;
grant all on public.skima_whatsapp_conversations to service_role;
grant all on public.skima_whatsapp_events to service_role;
grant all on public.skima_whatsapp_link_challenges to service_role;

commit;

    or normalized_wa_id !~ '^[0-9]{6,20}
  on public.skima_whatsapp_contacts(profile_id)
  where profile_id is not null;

create table if not exists public.skima_whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.skima_whatsapp_contacts(id) on delete cascade,
  state_key text not null default 'menu'
    check (state_key ~ '^[a-z][a-z0-9_.:-]{1,100}$'),
  state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(state) = 'object'),
  status text not null default 'active'
    check (status in ('active', 'paused', 'closed')),
  last_message_at timestamptz,
  expires_at timestamptz not null default (timezone('utc', now()) + interval '24 hours'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (contact_id)
);

create table if not exists public.skima_whatsapp_events (
  id uuid primary key default gen_random_uuid(),
  provider_message_id text not null unique,
  contact_id uuid references public.skima_whatsapp_contacts(id) on delete set null,
  event_type text not null default 'message'
    check (event_type in ('message', 'status', 'unsupported')),
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processing', 'processed', 'failed', 'ignored')),
  inbound_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(inbound_payload) = 'object'),
  error_message text,
  received_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz
);

create index if not exists skima_whatsapp_events_status_received_idx
  on public.skima_whatsapp_events(processing_status, received_at);

drop trigger if exists skima_whatsapp_contacts_set_updated_at on public.skima_whatsapp_contacts;
create trigger skima_whatsapp_contacts_set_updated_at
  before update on public.skima_whatsapp_contacts
  for each row execute function public.set_updated_at();

drop trigger if exists skima_whatsapp_conversations_set_updated_at on public.skima_whatsapp_conversations;
create trigger skima_whatsapp_conversations_set_updated_at
  before update on public.skima_whatsapp_conversations
  for each row execute function public.set_updated_at();

alter table public.skima_whatsapp_contacts enable row level security;
alter table public.skima_whatsapp_conversations enable row level security;
alter table public.skima_whatsapp_events enable row level security;

revoke all on public.skima_whatsapp_contacts from anon, authenticated;
revoke all on public.skima_whatsapp_conversations from anon, authenticated;
revoke all on public.skima_whatsapp_events from anon, authenticated;

grant all on public.skima_whatsapp_contacts to service_role;
grant all on public.skima_whatsapp_conversations to service_role;
grant all on public.skima_whatsapp_events to service_role;

commit;
 then
    return false;
  end if;

  select * into challenge_record
  from public.skima_whatsapp_link_challenges challenge
  where challenge.code_hash = encode(extensions.digest(normalized_code, 'sha256'), 'hex')
    and challenge.consumed_at is null
    and challenge.expires_at > timezone('utc', now())
    and challenge.attempt_count < 5
  for update;

  if not found then
    return false;
  end if;

  select * into contact_record
  from public.skima_whatsapp_contacts contact
  where contact.whatsapp_wa_id = normalized_wa_id
  for update;

  if found and (
    contact_record.link_status = 'blocked'
    or (contact_record.link_status = 'linked' and contact_record.profile_id <> challenge_record.profile_id)
  ) then
    update public.skima_whatsapp_link_challenges
    set attempt_count = least(attempt_count + 1, 5)
    where id = challenge_record.id;
    return false;
  end if;

  update public.skima_whatsapp_link_challenges
  set consumed_at = timezone('utc', now())
  where id = challenge_record.id;

  insert into public.skima_whatsapp_contacts (
    whatsapp_wa_id, profile_id, link_status, linked_at, last_inbound_at
  ) values (
    normalized_wa_id, challenge_record.profile_id, 'linked',
    timezone('utc', now()), timezone('utc', now())
  )
  on conflict (whatsapp_wa_id) do update
    set profile_id = excluded.profile_id,
        link_status = 'linked',
        linked_at = timezone('utc', now()),
        last_inbound_at = timezone('utc', now()),
        updated_at = timezone('utc', now());

  return true;
end;
$;

revoke all on function public.issue_skima_whatsapp_link_code() from public, anon;
grant execute on function public.issue_skima_whatsapp_link_code() to authenticated;
revoke all on function public.consume_skima_whatsapp_link_code(text, text) from public, anon, authenticated;
grant execute on function public.consume_skima_whatsapp_link_code(text, text) to service_role;

create index if not exists skima_whatsapp_contacts_profile_idx
  on public.skima_whatsapp_contacts(profile_id)
  where profile_id is not null;

create table if not exists public.skima_whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.skima_whatsapp_contacts(id) on delete cascade,
  state_key text not null default 'menu'
    check (state_key ~ '^[a-z][a-z0-9_.:-]{1,100}$'),
  state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(state) = 'object'),
  status text not null default 'active'
    check (status in ('active', 'paused', 'closed')),
  last_message_at timestamptz,
  expires_at timestamptz not null default (timezone('utc', now()) + interval '24 hours'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (contact_id)
);

create table if not exists public.skima_whatsapp_events (
  id uuid primary key default gen_random_uuid(),
  provider_message_id text not null unique,
  contact_id uuid references public.skima_whatsapp_contacts(id) on delete set null,
  event_type text not null default 'message'
    check (event_type in ('message', 'status', 'unsupported')),
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processing', 'processed', 'failed', 'ignored')),
  inbound_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(inbound_payload) = 'object'),
  error_message text,
  received_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz
);

create index if not exists skima_whatsapp_events_status_received_idx
  on public.skima_whatsapp_events(processing_status, received_at);

drop trigger if exists skima_whatsapp_contacts_set_updated_at on public.skima_whatsapp_contacts;
create trigger skima_whatsapp_contacts_set_updated_at
  before update on public.skima_whatsapp_contacts
  for each row execute function public.set_updated_at();

drop trigger if exists skima_whatsapp_conversations_set_updated_at on public.skima_whatsapp_conversations;
create trigger skima_whatsapp_conversations_set_updated_at
  before update on public.skima_whatsapp_conversations
  for each row execute function public.set_updated_at();

alter table public.skima_whatsapp_contacts enable row level security;
alter table public.skima_whatsapp_conversations enable row level security;
alter table public.skima_whatsapp_events enable row level security;

revoke all on public.skima_whatsapp_contacts from anon, authenticated;
revoke all on public.skima_whatsapp_conversations from anon, authenticated;
revoke all on public.skima_whatsapp_events from anon, authenticated;

grant all on public.skima_whatsapp_contacts to service_role;
grant all on public.skima_whatsapp_conversations to service_role;
grant all on public.skima_whatsapp_events to service_role;

commit;
