begin;

-- The platform audit trigger was originally written for UUID `id` tables only.
-- Some governed reference tables (for example currency_definitions) use a text
-- primary key such as `code`. Keep auditing enabled and derive a stable UUID
-- audit entity id for those records instead of disabling their audit trigger.
create or replace function public.record_table_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_state jsonb;
  target_id uuid;
  identifier_text text;
  identifier_digest text;
begin
  row_state := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  identifier_text := nullif(row_state ->> 'id', '');

  if identifier_text is not null
    and identifier_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    target_id := identifier_text::uuid;
  else
    identifier_text := coalesce(
      nullif(row_state ->> 'code', ''),
      nullif(row_state ->> 'key', ''),
      nullif(row_state ->> 'public_reference', ''),
      row_state::text
    );
    identifier_digest := md5(tg_table_schema || '.' || tg_table_name || ':' || identifier_text);
    target_id := (
      substr(identifier_digest, 1, 8) || '-' ||
      substr(identifier_digest, 9, 4) || '-' ||
      '4' || substr(identifier_digest, 14, 3) || '-' ||
      '8' || substr(identifier_digest, 18, 3) || '-' ||
      substr(identifier_digest, 21, 12)
    )::uuid;
  end if;

  insert into public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before_state,
    after_state
  )
  values (
    auth.uid(),
    tg_op,
    tg_table_name,
    target_id,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

commit;
