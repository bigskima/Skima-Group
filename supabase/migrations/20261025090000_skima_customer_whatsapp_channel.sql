begin;

create table if not exists public.skima_whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  whatsapp_wa_id text not null unique check (whatsapp_wa_id ~ '^[0-9]{6,20}$'),
  profile_id uuid references public.profiles(id) on delete set null,
  link_status text not null default 'unlinked'
    check (link_status in ('unlinked', 'pending', 'linked', 'blocked')),
  linked_at timestamptz,
  last_inbound_at timestamptz,
  link_attempt_count integer not null default 0 check (link_attempt_count between 0 and 5),
  link_attempt_window_started_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check ((link_status = 'linked') = (profile_id is not null))
);

create table if not exists public.skima_whatsapp_link_challenges (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  code_hash text not null unique,
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists skima_whatsapp_link_challenges_profile_idx
  on public.skima_whatsapp_link_challenges(profile_id, expires_at desc)
  where consumed_at is null;
create index if not exists skima_whatsapp_contacts_profile_idx
  on public.skima_whatsapp_contacts(profile_id)
  where profile_id is not null;

create table if not exists public.skima_whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.skima_whatsapp_contacts(id) on delete cascade unique,
  state_key text not null default 'menu'
    check (state_key ~ '^[a-z][a-z0-9_.:-]{1,100}$'),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  status text not null default 'active' check (status in ('active', 'paused', 'closed')),
  last_message_at timestamptz,
  expires_at timestamptz not null default (timezone('utc', now()) + interval '24 hours'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.skima_whatsapp_events (
  id uuid primary key default gen_random_uuid(),
  provider_message_id text not null unique,
  contact_id uuid references public.skima_whatsapp_contacts(id) on delete set null,
  event_type text not null default 'message'
    check (event_type in ('message', 'status', 'unsupported')),
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processing', 'processed', 'failed', 'ignored')),
  inbound_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(inbound_payload) = 'object'),
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

create or replace function public.issue_skima_whatsapp_link_code()
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
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
  where profile_id = actor_id and consumed_at is null;

  raw_code := upper(encode(extensions.gen_random_bytes(8), 'hex'));
  insert into public.skima_whatsapp_link_challenges (profile_id, code_hash, expires_at)
  values (
    actor_id,
    encode(extensions.digest(raw_code, 'sha256'), 'hex'),
    timezone('utc', now()) + interval '10 minutes'
  );
  return raw_code;
end;
$$;

create or replace function public.consume_skima_whatsapp_link_code(
  target_code text,
  target_whatsapp_wa_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  challenge_record public.skima_whatsapp_link_challenges%rowtype;
  contact_record public.skima_whatsapp_contacts%rowtype;
  normalized_code text := upper(btrim(coalesce(target_code, '')));
  normalized_wa_id text := btrim(coalesce(target_whatsapp_wa_id, ''));
  next_attempt_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if normalized_code !~ '^[A-F0-9]{16}$' or normalized_wa_id !~ '^[0-9]{6,20}$' then
    return false;
  end if;

  select * into contact_record
  from public.skima_whatsapp_contacts
  where whatsapp_wa_id = normalized_wa_id
  for update;
  if not found then
    insert into public.skima_whatsapp_contacts (whatsapp_wa_id)
    values (normalized_wa_id)
    on conflict (whatsapp_wa_id) do nothing;
    select * into contact_record from public.skima_whatsapp_contacts
    where whatsapp_wa_id = normalized_wa_id for update;
  end if;

  if contact_record.link_attempt_window_started_at is null
     or contact_record.link_attempt_window_started_at < timezone('utc', now()) - interval '1 hour' then
    next_attempt_count := 0;
  else
    next_attempt_count := contact_record.link_attempt_count;
  end if;
  if next_attempt_count >= 5 then
    return false;
  end if;
  update public.skima_whatsapp_contacts
  set link_attempt_count = next_attempt_count + 1,
      link_attempt_window_started_at = coalesce(
        case when next_attempt_count = 0 then timezone('utc', now()) end,
        link_attempt_window_started_at,
        timezone('utc', now())
      )
  where id = contact_record.id;

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

  if contact_record.link_status = 'blocked' then
    update public.skima_whatsapp_link_challenges
    set attempt_count = least(attempt_count + 1, 5)
    where id = challenge_record.id;
    return false;
  end if;

  if contact_record.link_status = 'linked' then
    if contact_record.profile_id = challenge_record.profile_id then
      update public.skima_whatsapp_link_challenges
      set consumed_at = timezone('utc', now())
      where id = challenge_record.id;
      return true;
    end if;
    update public.skima_whatsapp_link_challenges
    set attempt_count = least(attempt_count + 1, 5)
    where id = challenge_record.id;
    return false;
  end if;

  update public.skima_whatsapp_link_challenges
  set consumed_at = timezone('utc', now())
  where id = challenge_record.id;

  update public.skima_whatsapp_contacts
  set profile_id = challenge_record.profile_id,
      link_status = 'linked',
      linked_at = timezone('utc', now()),
      link_attempt_count = 0,
      link_attempt_window_started_at = null,
      metadata = metadata || jsonb_build_object('link_method', 'one_time_code')
  where id = contact_record.id;

  return true;
end;
$$;

alter table public.skima_whatsapp_contacts enable row level security;
alter table public.skima_whatsapp_link_challenges enable row level security;
alter table public.skima_whatsapp_conversations enable row level security;
alter table public.skima_whatsapp_events enable row level security;

revoke all on public.skima_whatsapp_contacts from public, anon, authenticated;
revoke all on public.skima_whatsapp_link_challenges from public, anon, authenticated;
revoke all on public.skima_whatsapp_conversations from public, anon, authenticated;
revoke all on public.skima_whatsapp_events from public, anon, authenticated;
revoke all on function public.issue_skima_whatsapp_link_code() from public, anon;
revoke all on function public.consume_skima_whatsapp_link_code(text, text) from public, anon, authenticated;

grant all on public.skima_whatsapp_contacts to service_role;
grant all on public.skima_whatsapp_link_challenges to service_role;
grant all on public.skima_whatsapp_conversations to service_role;
grant all on public.skima_whatsapp_events to service_role;
grant execute on function public.issue_skima_whatsapp_link_code() to authenticated;
grant execute on function public.consume_skima_whatsapp_link_code(text, text) to service_role;

commit;
