begin;

-- A single trigger function is attached to both geographies and
-- operational_coverage_assignments. PostgreSQL does not guarantee
-- short-circuit evaluation of record-field references inside one boolean
-- expression, so fields that exist only on one table must be accessed only
-- after TG_TABLE_NAME has selected that table.

create or replace function public.require_previewed_geometry_draft()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  draft record;
  draft_id uuid;
begin
  if tg_table_name = 'geographies' then
    if new.status = 'active'
       and new.metadata ->> 'sourceSurface' = 'admin_geography' then
      draft_id := nullif(new.metadata ->> 'geometryDraftId', '')::uuid;
    else
      return new;
    end if;
  elsif tg_table_name = 'operational_coverage_assignments' then
    if new.status = 'active'
       and new.coverage_type = 'CUSTOM_ZONE'
       and new.metadata ->> 'sourceSurface' = 'admin_operational_coverage'
       and (
         tg_op = 'INSERT'
         or new.coverage_geometry is distinct from old.coverage_geometry
       ) then
      draft_id := nullif(new.metadata ->> 'geometryDraftId', '')::uuid;
    else
      return new;
    end if;
  else
    return new;
  end if;

  select *
  into draft
  from public.coverage_geometry_drafts
  where id = draft_id
    and status = 'PREVIEWED';

  if not found then
    raise exception using
      errcode = '23514',
      message = 'active geometry requires a previewed preserved draft';
  end if;

  if tg_table_name = 'geographies' then
    if not extensions.st_equals(
      draft.geometry::extensions.geometry,
      new.boundary_geometry::extensions.geometry
    ) then
      raise exception using
        errcode = '23514',
        message = 'active geography does not match its previewed geometry draft';
    end if;
  elsif tg_table_name = 'operational_coverage_assignments' then
    if not extensions.st_equals(
      draft.geometry::extensions.geometry,
      new.coverage_geometry::extensions.geometry
    ) then
      raise exception using
        errcode = '23514',
        message = 'active coverage does not match its previewed geometry draft';
    end if;
  end if;

  return new;
end
$$;

comment on function public.require_previewed_geometry_draft() is
  'Requires a previewed geometry draft for admin-authored active geography/custom coverage changes. Table-specific NEW fields are accessed only after TG_TABLE_NAME branching.';

commit;
