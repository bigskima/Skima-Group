const [migration, orderScreen, ordersScreen, detailsScreen, driverScreen, stationScreen, runtime] = await Promise.all([
  Deno.readTextFile("supabase/migrations/20261110080000_fuel_customer_container_exchange.sql"),
  Deno.readTextFile("apps/lpg-mobile/src/native/ui/FuelOrderScreen.tsx"),
  Deno.readTextFile("apps/lpg-mobile/src/native/ui/FuelOrdersScreen.tsx"),
  Deno.readTextFile("apps/lpg-mobile/src/native/ui/FuelOrderDetailsScreen.tsx"),
  Deno.readTextFile("apps/lpg-mobile/src/native/ui/FuelDriverJobsScreen.tsx"),
  Deno.readTextFile("apps/lpg-mobile/src/native/ui/FuelStationOperationsScreen.tsx"),
  Deno.readTextFile("supabase/functions/fuel-runtime/index.ts"),
]);

function includes(source: string, value: string, message: string): void {
  if (!source.includes(value)) throw new Error(message + ": missing " + value);
}
function excludes(source: string, value: string, message: string): void {
  if (source.includes(value)) throw new Error(message + ": unexpected " + value);
}

Deno.test("Fuel customer can choose buy, rent or exchange without a purchase-history requirement", () => {
  includes(orderScreen, 'type ContainerMode = "purchase" | "rental" | "exchange"', "Customer app supports the exchange choice");
  includes(orderScreen, 'title="Use my container"', "Customer-facing exchange label");
  includes(orderScreen, "You do not need a previous SKIMA purchase record", "No SKIMA purchase history is required");
  includes(orderScreen, 'containerMode !== "exchange"', "Exchange is not charged as a container purchase or rental");
  includes(orderScreen, "filled SKIMA container of the same size", "Customer understands the physical exchange");
  includes(ordersScreen, 'savedMode === "exchange" ? "Container exchange"', "Customer order history identifies exchanges");
  includes(detailsScreen, "isExchange", "Customer order details distinguish exchange from purchase and rental");
});

Deno.test("Selected container capacity is enforced both in the app and database", () => {
  includes(orderScreen, "requestedLitres <= nominalCapacity", "Customer checkout validates the chosen container capacity");
  includes(orderScreen, "can hold no more than", "Customer sees an understandable over-capacity message");
  includes(migration, "requested_litres>container_type_record.nominal_capacity_litres", "Order initializer enforces the physical maximum");
  includes(migration, "target_requested_litres>container_type_record.nominal_capacity_litres", "Order creation RPC enforces the same maximum");
  includes(migration, "requested_container_count:=1", "Server derives one container of the chosen size");
  includes(migration, "target_allocated_litres>profile_record.capacity_litres", "Allocated SKIMA asset must fit the complete requested quantity");
});

Deno.test("Exchange has no purchase, rental or deposit charge", () => {
  includes(migration, "when operation_record.container_mode='rental' then offer_record.container_rental_amount", "Rental remains chargeable");
  includes(migration, "else 0", "Exchange container amount is zero");
  includes(migration, "target_allocation_mode='exchange'", "Allocation runtime recognizes exchange");
  includes(migration, "target_purchase_amount<>0 or target_rental_amount<>0 or target_refundable_deposit_amount<>0", "Database rejects any exchange container charge or deposit");
});

Deno.test("Exchange handoff is recorded by the assigned driver and required by the backend", () => {
  includes(driverScreen, "exchangeConfirmationOrderId", "Driver confirmation is tied to the selected order");
  includes(driverScreen, "I collected the customer's empty container", "Driver sees the required collection confirmation");
  includes(driverScreen, "containerExchangeCollected: isExchange ? exchangeCollectionConfirmed : false", "Driver submits the physical handoff confirmation");
  includes(runtime, "payload.containerExchangeCollected !== true", "Edge runtime rejects an unconfirmed exchange");
  includes(runtime, "customer_container_collected_by: isContainerExchange ? authResult.user.id : null", "The assigned driver is recorded");
  includes(migration, "new.metadata->>'customer_container_collected' is distinct from 'true'", "Database independently guards the delivery event");
  includes(stationScreen, "assigned driver must collect the customer's empty container", "Station gets explicit exchange fulfilment instructions");
});

Deno.test("Customer exchange is completed only after the delivery OTP", () => {
  includes(migration, "operation.container_mode in ('purchase','exchange')", "Exchange is completed through verified delivery like a purchase");
  excludes(detailsScreen, 'value="exchange"', "Internal mode token is not shown as UI copy");
});
