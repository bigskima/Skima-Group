-- Keep the public Refill discovery URL aligned with the canonical singular host.
-- The other three products remain independently hosted and unchanged.
update public.customer_service_discovery_links
set
  display_name = 'SKIMA Refill',
  description = 'Order LPG refills, fuel and supported energy services.',
  web_url = 'https://refill.skima.online/',
  sort_order = 10,
  updated_at = now()
where service_key = 'refill';
