-- Preserve compatibility between the legacy LPG quote insert and the commercial quote snapshot.
-- quoted_kg is an immutable commercial quantity snapshot; legacy callers already provide
-- the same authoritative quantity as requested_kg but predate the quoted_kg column.

create or replace function public.ensure_lpg_refill_quote_quoted_kg()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.quoted_kg is null then
    new.quoted_kg := new.requested_kg;
  end if;

  if new.quoted_kg is null or new.quoted_kg <= 0 then
    raise exception 'quoted_kg must be greater than zero';
  end if;

  return new;
end;
$$;

revoke all on function public.ensure_lpg_refill_quote_quoted_kg() from public;
revoke all on function public.ensure_lpg_refill_quote_quoted_kg() from anon;
revoke all on function public.ensure_lpg_refill_quote_quoted_kg() from authenticated;

drop trigger if exists trg_lpg_refill_quotes_quoted_kg_compatibility
  on public.lpg_refill_quotes;

create trigger trg_lpg_refill_quotes_quoted_kg_compatibility
before insert on public.lpg_refill_quotes
for each row
execute function public.ensure_lpg_refill_quote_quoted_kg();

comment on function public.ensure_lpg_refill_quote_quoted_kg() is
  'Compatibility guard that snapshots quoted_kg from requested_kg when legacy LPG quote callers omit the newer commercial quantity snapshot.';
