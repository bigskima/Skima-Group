begin;

-- Legacy dispatcher cleanup and invitation acceptance are implemented by
-- 20261021110000_lpg_station_driver_invites_auto_dispatch.sql. Keep this
-- versioned migration as a no-op so it cannot reintroduce the old UUID-returning
-- acceptance RPC or remove the canonical pending-order dispatcher.

commit;
