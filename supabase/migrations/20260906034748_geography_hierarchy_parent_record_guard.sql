begin;

-- parent is a RECORD that is populated only when parent_id is present.
-- Do not reference parent fields inside a boolean expression that also tests
-- parent_id, because SQL expression evaluation is not a control-flow guard.

create or replace function public.validate_geography_hierarchy_and_geometry()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  child_level record;
  parent record;
begin
  if new.parent_id = new.id then
    raise exception using errcode = '23514', message = 'geography cannot be its own parent';
  end if;

  if new.parent_id is not null and exists(
    with recursive descendants as (
      select id from public.geographies where parent_id = new.id
      union all
      select child.id
      from public.geographies child
      join descendants on child.parent_id = descendants.id
    )
    select 1 from descendants where id = new.parent_id
  ) then
    raise exception using errcode = '23514', message = 'geography hierarchy cycle is not allowed';
  end if;

  select *
  into child_level
  from public.geography_levels
  where id = new.geography_level_id;

  if not found or child_level.status <> 'active' then
    raise exception using errcode = '23514', message = 'geography requires an active configured level';
  end if;

  if new.parent_id is not null then
    select geography.*, level.specificity_rank parent_specificity
    into parent
    from public.geographies geography
    join public.geography_levels level on level.id = geography.geography_level_id
    where geography.id = new.parent_id;

    if not found then
      raise exception using errcode = '23514', message = 'parent geography was not found';
    end if;

    if parent.country_code <> new.country_code then
      raise exception using errcode = '23514', message = 'parent and child geographies must use the same country code';
    end if;

    if parent.parent_specificity >= child_level.specificity_rank then
      raise exception using errcode = '23514', message = 'child geography must use a more-specific configured level than its parent';
    end if;
  end if;

  if new.status = 'active' and new.boundary_geometry is null then
    raise exception using errcode = '23514', message = 'active geography requires a boundary';
  end if;

  if new.boundary_geometry is not null then
    if extensions.st_isempty(new.boundary_geometry::extensions.geometry)
       or not extensions.st_isvalid(new.boundary_geometry::extensions.geometry)
       or extensions.st_area(new.boundary_geometry) <= 0 then
      raise exception using errcode = '23514',
        message = 'geography boundary must be a non-empty valid polygon with positive area';
    end if;

    if new.parent_id is not null then
      if parent.boundary_geometry is not null
         and child_level.key <> 'custom_zone'
         and not extensions.st_covers(parent.boundary_geometry, new.boundary_geometry) then
        raise exception using errcode = '23514',
          message = 'administrative child boundary must be covered by its parent boundary';
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_geography_hierarchy_and_geometry() is
  'Validates geography hierarchy and geometry without reading an unassigned parent record when a geography has no parent.';

commit;
