const batch = await Deno.readTextFile(
  "supabase/migrations/20261030270000_fuel_atomic_order_stock_batches.sql",
);
const inventory = await Deno.readTextFile(
  "supabase/migrations/20261030220000_fuel_inventory_reservation_runtime.sql",
);

function requireIncludes(source: string, value: string, message: string): void {
  if (!source.includes(value)) throw new Error(`${message}: missing "${value}"`);
}

Deno.test("Fuel stock batches cover the full order across compatible station tanks atomically", () => {
  requireIncludes(batch, "create table if not exists public.fuel_order_stock_reservation_batches", "stock batch table exists");
  requireIncludes(batch, "create or replace function public.reserve_fuel_order_stock(", "batch reservation RPC exists");
  requireIncludes(batch, "pg_advisory_xact_lock(hashtextextended(target_order_id::text,0))", "concurrent batches for one order are serialized");
  requireIncludes(batch, "hold_record.status='held'", "a confirmed escrow hold is required");
  requireIncludes(batch, "hold_record.hold_amount=order_record.total_amount", "escrow amount must match the funded order total");
  requireIncludes(batch, "storage.product_key=operation_record.product_key", "only matching fuel-product tanks can supply the order");
  requireIncludes(batch, "storage.branch_id=operation_record.station_branch_id", "only the selected station branch can supply the order");
  requireIncludes(batch, "storage_record.physical_stock_litres", "reservation uses physical tank stock");
  requireIncludes(batch, "storage_record.safety_reserve_litres", "tank safety reserve is protected");
  requireIncludes(batch, "Insufficient available Fuel stock across all active compatible station storage units", "insufficient aggregate stock aborts the complete batch");
  requireIncludes(batch, "where reservation.batch_id=batch_record.id", "idempotent batch replay returns its original tank reservations");
  requireIncludes(batch, "public.can_read_fuel_order(order_id)", "batch reads are scoped by order access");
});

Deno.test("Fuel partial dispense preserves unused reservation for later measured fills", () => {
  requireIncludes(inventory, "newly_consumed_total:=reservation_record.consumed_litres+target_consumed_litres", "partial fills accumulate on an individual reservation");
  requireIncludes(inventory, "reserved_after:=storage_record.reserved_stock_litres-target_consumed_litres", "reservation balance falls only by actual dispensed litres");
  requireIncludes(inventory, "status=case when newly_consumed_total>=reserved_litres-0.001 then 'consumed' else 'partially_consumed' end", "partial reservations stay open until fully consumed");
  requireIncludes(inventory, "remaining_litres:=reservation_record.reserved_litres-reservation_record.consumed_litres", "release only frees the outstanding reservation balance");
});
