const migration = await Deno.readTextFile("supabase/migrations/20261019090000_lpg_station_managed_fulfillment.sql");
const customer = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/NewRefillScreen.tsx");
const station = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/StationManagedFulfillmentScreen.tsx");
const gateway = await Deno.readTextFile("supabase/functions/api-gateway/index.ts");
const admin = await Deno.readTextFile("apps/admin/src/admin-station-managed-fulfillment-workspace.tsx");
const adminRouter = await Deno.readTextFile("apps/admin/src/features/partners/PartnersWorkspaceRouter.tsx");

function requireText(source: string, fragment: string, label: string) {
  if (!source.includes(fragment)) throw new Error(`${label}: missing required contract fragment: ${fragment}`);
}

Deno.test("Station Managed remains a fulfillment mode distinct from the channel", () => {
  requireText(migration, "fulfillment_mode text not null default 'independent_driver'", "additive mode");
  requireText(migration, "check (fulfillment_mode in ('station_managed','independent_driver','skima_fleet','partner_managed'))", "mode constraint");
  requireText(migration, "fulfillment_channel = 'skima_internal' then 'skima_fleet'", "legacy SKIMA Fleet mapping");
  requireText(migration, "fulfillment_channel<>'marketplace' or order_record.fulfillment_mode<>'station_managed'", "assignment guard");
});

Deno.test("Station delivery pricing is snapshotted and totals are recalculated", () => {
  requireText(migration, "delivery_pricing_mode text not null default 'separate'", "pricing mode");
  requireText(migration, "new.total_amount:=new.lpg_amount+new.delivery_fee_amount+new.platform_fee_amount+new.tax_amount", "quote total");
  requireText(migration, "'station_fulfillment_pricing_locked',true", "pricing idempotency");
  requireText(customer, "metadata: { fulfillment_mode: fulfillmentMode }", "customer quote mode");
  requireText(customer, "Delivery (included)", "included delivery label");
  requireText(customer, "Delivery (free)", "free delivery label");
});

Deno.test("Station drivers remain outside SKIMA driver and payout ledgers", () => {
  requireText(migration, "create table if not exists public.lpg_station_managed_drivers", "station driver table");
  requireText(migration, "a SKIMA Managed or independent driver profile cannot also be registered", "driver identity separation");
  requireText(migration, "Station Managed drivers are paid by the station, never by SKIMA", "payout guard");
  requireText(migration, "Station drivers are compensated by their station, never by SKIMA.", "delivery trigger guard");
  requireText(migration, "lpg_station_managed_driver_payment_records", "station payment record");
  requireText(station, "SKIMA did not execute this payment.", "station payment disclaimer");
});

Deno.test("Station Managed orders bypass SKIMA dispatch automation", () => {
  requireText(migration, "if fulfillment_mode=''station_managed'' then", "reservation dispatcher guard");
  requireText(migration, "target_order.fulfillment_mode<>''station_managed''", "lifecycle worker guard");
  requireText(migration, "Station Managed orders must use station-owned driver assignment, not SKIMA dispatch", "manual dispatch guard");
  requireText(migration, "is_lpg_station_managed_order_driver", "station driver scan identity");
});

Deno.test("Station workspace and API surfaces are wired", () => {
  requireText(migration, "read_lpg_station_managed_workspace", "station workspace read API");
  requireText(station, "configure_lpg_station_managed_fulfillment", "station pricing settings");
  requireText(station, "register_lpg_station_managed_driver", "station driver registration");
  requireText(station, "assign_lpg_station_managed_driver", "station assignment");
  requireText(station, "record_lpg_station_managed_driver_agreement", "agreement records");
  requireText(station, "record_lpg_station_managed_driver_payment", "payment confirmation records");
  requireText(gateway, "fulfillment_mode,delivery_pricing_mode,station_delivery_fee_amount", "quote and order API projections");
});

Deno.test("Admin dashboard has read-only Station Managed oversight", () => {
  requireText(migration, "read_lpg_admin_station_managed_fulfillment", "admin oversight RPC");
  requireText(migration, "platform station fulfillment oversight permission is required", "admin permission guard");
  requireText(admin, "read_lpg_admin_station_managed_fulfillment", "admin dashboard data source");
  requireText(admin, "Station-entered confirmations only. SKIMA did not execute these driver payments.", "admin payment disclaimer");
  requireText(admin, "Review drivers, assignments, agreements and payment confirmations", "admin record review");
  requireText(adminRouter, "/partners/stations/managed-fulfillment", "admin route");
});
