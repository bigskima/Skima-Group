const stock = await Deno.readTextFile(
  "supabase/migrations/20261030220000_fuel_inventory_reservation_runtime.sql",
);
const containers = await Deno.readTextFile(
  "supabase/migrations/20261030230000_fuel_container_custody_runtime.sql",
);
const operations = await Deno.readTextFile(
  "supabase/migrations/20261030210000_fuel_order_processing_runtime.sql",
);

function requireIncludes(source: string, fragment: string, message: string): void {
  if (!source.includes(fragment)) {
    throw new Error(`${message}: missing "${fragment}"`);
  }
}

function requireNotIncludes(source: string, fragment: string, message: string): void {
  if (source.includes(fragment)) {
    throw new Error(`${message}: unexpected "${fragment}"`);
  }
}

Deno.test("Fuel stock receipts and adjustments are capacity- and reserve-safe", () => {
  requireIncludes(stock, "public.receive_fuel_stock(", "stock receipt RPC exists");
  requireIncludes(stock, "public.adjust_fuel_stock(", "stock adjustment RPC exists");
  requireIncludes(stock, "physical_after>storage_record.capacity_litres", "stock cannot exceed the configured tank capacity");
  requireIncludes(stock, "physical_after<storage_record.reserved_stock_litres+storage_record.safety_reserve_litres", "stock adjustments preserve reservations and safety reserve");
  requireIncludes(stock, "fuel_station_stock_movements", "every physical movement is journaled");
  requireIncludes(stock, "fuel_station_stock_movements_audit", "physical stock movements are audited");
  requireIncludes(stock, "fuel stock idempotency key was reused with different receipt details", "receipt retries are replay-safe");
  requireIncludes(stock, "fuel stock idempotency key was reused with different adjustment details", "adjustment retries are replay-safe");
});

Deno.test("Fuel reservations are atomic and never oversell available litres", () => {
  requireIncludes(stock, "public.reserve_fuel_stock(", "atomic stock reservation RPC exists");
  requireIncludes(stock, "pg_advisory_xact_lock(hashtextextended(target_order_id::text,0))", "multi-tank reservations for one order are serialized");
  requireIncludes(stock, "where id=target_storage_unit_id\n  for update", "storage row is locked before reserving stock");
  requireIncludes(stock, "physical_stock_litres-storage_record.reserved_stock_litres-storage_record.safety_reserve_litres<target_quantity_litres", "reservation respects currently available litres after safety reserve");
  requireIncludes(stock, "reserved_total+coalesce(operation_record.filled_litres,0)+target_quantity_litres>operation_record.requested_litres", "reservation total is bounded by remaining order litres");
  requireIncludes(stock, "public.release_fuel_stock_reservation(", "cancel/failure can release unconsumed stock");
  requireIncludes(stock, "public.consume_fuel_stock_reservation(", "station fill consumes the stock reservation");
  requireIncludes(stock, "fuel_stock_reservation_events", "reservation changes are separately audited from physical movements");
  requireIncludes(stock, "status='reserved'", "closed or partially consumed reservations are not counted as still held");
  requireNotIncludes(stock, "fuel_order_stock_reservations_one_open_line", "multiple tanks can contribute to one fuel order");
});

Deno.test("Fuel stock dispense records actual litres and releases unused reservation", () => {
  requireIncludes(stock, "physical_after:=storage_record.physical_stock_litres-target_consumed_litres", "physical stock falls by measured filled litres");
  requireIncludes(stock, "reserved_after:=storage_record.reserved_stock_litres-reservation_record.reserved_litres", "the unused part of a reservation is released");
  requireIncludes(stock, "filled_litres=total_filled", "measured fill accumulates against the order quantity");
  requireIncludes(stock, "'dispense',-target_consumed_litres", "physical dispense is an append-only stock movement");
  requireIncludes(stock, "Fuel dispense would consume stock reserved for other orders or safety reserve", "other orders' reservations and safety stock remain protected");
});

Deno.test("Fuel container registration and allocation are tied to real asset identities", () => {
  requireIncludes(containers, "public.register_fuel_container_asset(", "admin container registration RPC exists");
  requireIncludes(containers, "'asset.fuel-container'", "container registration creates a typed asset");
  requireIncludes(containers, "public.reserve_fuel_order_container(", "container reservation is performed through a controlled RPC");
  requireIncludes(containers, "quote_record.currency_code<>target_currency_code", "allocation currency matches the accepted commercial quote");
  requireIncludes(containers, "container allocations exceed accepted quote count, litres or commercial amounts", "container count, litres, rent/purchase amounts and deposit cannot exceed the quote");
  requireIncludes(containers, "only available SKIMA-owned containers can be allocated", "only SKIMA inventory can be rented or sold through this workflow");
});

Deno.test("Purchased containers transfer ownership only at customer delivery", () => {
  requireIncludes(containers, "target_event_key='delivered_to_customer'", "container delivery is a controlled custody event");
  requireIncludes(containers, "update public.assets\n    set owner_user_id=allocation_record.customer_user_id", "purchase ownership transfers to the verified customer");
  requireIncludes(containers, "ownership_mode='customer'", "container ownership mode changes to customer");
  requireIncludes(containers, "'ownership_transferred'", "ownership transfer has its own custody record");
  requireIncludes(containers, "next_allocation_status:=case when allocation_record.allocation_mode='purchase' then 'ownership_transferred' else 'delivered' end", "a purchased container closes its reusable allocation after sale");
});

Deno.test("Rental containers remain SKIMA-owned and require station receipt and inspection", () => {
  requireIncludes(containers, "allocation_record.allocation_mode<>'rental'", "return operations are restricted to rentals");
  requireIncludes(containers, "target_event_key='returned_to_driver'", "customer-to-driver return is recorded");
  requireIncludes(containers, "target_event_key='received_at_station'", "driver-to-station receipt is recorded");
  requireIncludes(containers, "public.record_fuel_container_inspection(", "station inspection uses a controlled operation");
  requireIncludes(containers, "last_inspection_result=target_inspection_result", "inspection result is persisted");
  requireIncludes(containers, "next_profile_status:='available'", "only a passed inspection releases a rental container for reuse");
  requireIncludes(containers, "next_allocation_status:='exception'", "failed/conditional inspection does not mark a container available");
  requireIncludes(containers, "Rental fuel containers must be returned and inspected before completion", "rental order completion is gated on inspection");
});

Deno.test("Container custody follows the assigned driver and preserves append-only evidence", () => {
  requireIncludes(containers, "assignment.participant_role='driver'", "custody actor is matched to the order driver");
  requireIncludes(containers, "assignment.status='active'", "only the active assignment can hand over the container");
  requireIncludes(containers, "fuel_container_custody_events", "custody evidence is persisted");
  requireIncludes(containers, "fuel_container_custody_events_immutable", "custody evidence is append-only");
  requireIncludes(containers, "grant execute on function public.record_fuel_container_handover", "custody handover is routed through trusted service runtime");
  requireIncludes(operations, "Every prepared container must be recorded as handed to the assigned driver", "driver handover is checked before leaving station");
  requireIncludes(operations, "Every filled container must be delivered and measured against the customer-verified quantity", "delivery requires complete container proof");
});
