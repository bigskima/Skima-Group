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
