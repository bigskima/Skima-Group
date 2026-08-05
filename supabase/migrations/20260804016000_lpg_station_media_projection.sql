begin;

create or replace function public.project_lpg_station_application_media()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_application_id_text text;
begin
  source_application_id_text := coalesce(
    nullif(new.metadata ->> 'activated_from_application_id', ''),
    nullif(new.metadata ->> 'source_application_id', '')
  );

  if source_application_id_text is not null
    and source_application_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    perform public.project_application_media_assets(
      source_application_id_text::uuid,
      'lpg.station_branch',
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists lpg_station_branches_project_application_media
on public.lpg_station_branches;

create trigger lpg_station_branches_project_application_media
after insert or update of metadata on public.lpg_station_branches
for each row execute function public.project_lpg_station_application_media();

do $$
declare
  station_record record;
  source_application_id_text text;
begin
  for station_record in
    select station.id, station.metadata
    from public.lpg_station_branches station
  loop
    source_application_id_text := coalesce(
      nullif(station_record.metadata ->> 'activated_from_application_id', ''),
      nullif(station_record.metadata ->> 'source_application_id', '')
    );

    if source_application_id_text is not null
      and source_application_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      perform public.project_application_media_assets(
        source_application_id_text::uuid,
        'lpg.station_branch',
        station_record.id
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.project_lpg_station_application_media() from public, anon, authenticated;

commit;
