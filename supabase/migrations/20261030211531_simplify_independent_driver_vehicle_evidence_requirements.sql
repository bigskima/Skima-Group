do $migration$
declare
  vehicle_set_id uuid;
  required_items integer;
begin
  select id into vehicle_set_id
  from public.document_requirement_sets
  where key = 'documents.lpg.vehicle.phase-one'
    and status = 'active';

  if vehicle_set_id is null then
    raise exception 'active LPG vehicle document requirement set is missing';
  end if;

  select count(*) into required_items
  from public.document_requirements
  where requirement_set_id = vehicle_set_id
    and key in (
      'vehicle.inspection',
      'vehicle.insurance',
      'vehicle.lpg-transport',
      'vehicle.ownership-authorization',
      'vehicle.photo',
      'vehicle.registration',
      'vehicle.roadworthiness'
    );

  if required_items <> 7 then
    raise exception 'expected 7 existing LPG vehicle requirements, found %', required_items;
  end if;

  update public.document_requirements requirement
  set
    is_required = case requirement.key
      when 'vehicle.inspection' then false
      when 'vehicle.lpg-transport' then false
      else true
    end,
    display_name = case requirement.key
      when 'vehicle.inspection' then 'Additional inspection evidence (if requested)'
      when 'vehicle.lpg-transport' then 'Additional LPG transport evidence (if requested)'
      when 'vehicle.ownership-authorization' then 'Ownership or vehicle-use authorization'
      when 'vehicle.photo' then 'Vehicle photo showing registration plate'
      when 'vehicle.registration' then 'Vehicle registration / proof of ownership'
      when 'vehicle.roadworthiness' then 'Roadworthiness certificate'
      else requirement.display_name
    end,
    description = case requirement.key
      when 'vehicle.inspection' then 'Not a routine separate upload. SKIMA may request extra inspection evidence if the submitted roadworthiness certificate or vehicle review raises a question.'
      when 'vehicle.lpg-transport' then 'Not a routine separate upload. SKIMA reviews LPG transport safety during vehicle approval and may request supporting evidence where applicable.'
      when 'vehicle.ownership-authorization' then 'Required only when the vehicle is leased, rented, fleet-assigned or authorized by another owner. Upload one current lease, rental agreement or signed owner authorization.'
      when 'vehicle.photo' then 'Upload one clear photo showing the full vehicle and its visible registration plate. SKIMA may request more safety photos if needed.'
      when 'vehicle.registration' then 'Upload one PDF or clear image showing the official vehicle registration details and registered owner. If the registration and proof-of-ownership papers are separate, combine the pages into one PDF.'
      when 'vehicle.roadworthiness' then 'Upload the current roadworthiness certificate. This is the normal vehicle inspection evidence for independent drivers; a second, separate inspection document is not routinely required.'
      else requirement.description
    end,
    max_count = case requirement.key
      when 'vehicle.photo' then 1
      when 'vehicle.ownership-authorization' then 1
      else requirement.max_count
    end,
    metadata = case requirement.key
      when 'vehicle.ownership-authorization' then
        coalesce(requirement.metadata, '{}'::jsonb) ||
        jsonb_build_object(
          'required_when',
          jsonb_build_object(
            'path', 'vehicle.ownershipType',
            'operator', 'not_equals',
            'value', 'driver_owned'
          )
        )
      when 'vehicle.inspection' then
        coalesce(requirement.metadata, '{}'::jsonb) ||
        jsonb_build_object('collection_mode', 'optional_on_request')
      when 'vehicle.lpg-transport' then
        coalesce(requirement.metadata, '{}'::jsonb) ||
        jsonb_build_object('collection_mode', 'optional_on_request')
      else coalesce(requirement.metadata, '{}'::jsonb)
    end,
    updated_at = timezone('utc', now())
  where requirement.requirement_set_id = vehicle_set_id
    and requirement.key in (
      'vehicle.inspection',
      'vehicle.insurance',
      'vehicle.lpg-transport',
      'vehicle.ownership-authorization',
      'vehicle.photo',
      'vehicle.registration',
      'vehicle.roadworthiness'
    );

  if (select count(*) from public.document_requirements
      where requirement_set_id = vehicle_set_id
        and status = 'active'
        and is_required) <> 5 then
    raise exception 'vehicle evidence simplification did not produce the expected 5 conditional/standard required definitions';
  end if;
end;
$migration$;