begin;

-- Onitsha spans two selectable LGA records. An address that names only
-- "Onitsha" should resolve to their shared parent rather than Nigeria.
update public.geographies
set aliases = case
  when coalesce(aliases, '[]'::jsonb) ? 'Onitsha'
    then coalesce(aliases, '[]'::jsonb)
    else coalesce(aliases, '[]'::jsonb) || '["Onitsha"]'::jsonb
end || case
  when coalesce(aliases, '[]'::jsonb) ? 'Ointsha'
    then '[]'::jsonb
    else '["Ointsha"]'::jsonb
end,
updated_at = timezone('utc', now())
where country_code = 'NG'
  and canonical_name in ('Onitsha North', 'Onitsha South')
  and status = 'active';

commit;
