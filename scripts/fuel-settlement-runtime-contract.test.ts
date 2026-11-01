const migration = await Deno.readTextFile(
  "supabase/migrations/20261102002000_fuel_order_settlement_runtime.sql",
);
const quote = await Deno.readTextFile(
  "supabase/migrations/20261101202500_fuel_commercial_quote_runtime.sql",
);
const quotePatch = await Deno.readTextFile(
  "supabase/migrations/20261102001000_fuel_quote_arithmetic_correction.sql",
);
const gateway = await Deno.readTextFile("supabase/functions/api-gateway/index.ts");
const customerScreen = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/FuelOrderDetailsScreen.tsx");

function includes(source: string, fragment: string, message: string): void {
  if (!source.includes(fragment)) throw new Error(`${message}: missing "${fragment}"`);
}
function excludes(source: string, fragment: string, message: string): void {
  if (source.includes(fragment)) throw new Error(`${message}: unexpected "${fragment}"`);
}

Deno.test("Fuel settlement is atomic with the final order completion transition", () => {
  includes(migration, "create or replace function public.settle_fuel_order(", "Fuel settlement procedure exists");
  includes(migration, "public.execute_service_request_settlement(", "settlement uses the shared escrow settlement engine");
  includes(migration, "create trigger fuel_order_settlement_on_completion", "final completion automatically triggers settlement");
  includes(migration, "new.stage_key='completed' and old.stage_key is distinct from new.stage_key", "trigger fires only on the completion transition");
  includes(migration, "if auth.role()<>'service_role' then", "settlement cannot be invoked by clients");
  includes(migration, "settlement_execution_id", "settlement execution is persisted to the Fuel order");
  includes(migration, "settlement_transaction_id", "financial transaction is linked to the Fuel order");
  includes(migration, "settlement_statement_id", "station settlement statement is linked to the Fuel order");
});

Deno.test("Fuel settlement routes each locked component to the correct beneficiary wallet", () => {
  includes(migration, "quote_record.fuel_amount", "station receives the measured fuel principal");
  includes(migration, "operation_record.fulfillment_mode='station_managed'", "station-managed driver compensation is station-paid");
  includes(migration, "driver_profile_record.id", "marketplace and SKIMA drivers receive their driver-wallet allocation");
  includes(migration, "ensure_platform_revenue_wallet", "container proceeds and platform fees use the platform revenue wallet");
  includes(migration, "ensure_platform_liability_wallet", "tax is credited to the platform liability wallet");
  includes(migration, "customer_refundable_deposit_return", "rental deposit is credited to the customer wallet");
  includes(migration, "all_rental_containers_received_and_inspected", "rental deposit waits for completed return and inspection");
  includes(migration, "remaining_escrow_amount-quote_record.grand_total", "escrow balance must match the accepted commercial quote");
  includes(migration, "deposit_refund_amount=v_deposit_refund_amount", "the actual refundable deposit amount is persisted to the customer read model");
  includes(migration, "public.sync_fuel_accepted_quote_deposit_amount()", "accepted quotes sync the refund amount to the order read model");
  includes(migration, "set deposit_refund_amount=new.refundable_deposit_amount", "customers can see the refundable amount before settlement");
});

Deno.test("the Fuel commercial quote total uses the server-calculated subtotal", () => {
  includes(quote, "grand_total:=resolved_subtotal_amount+platform_fee_amount+tax_amount;", "quote grand total uses resolved subtotal");
  excludes(quote, "grand_total:=subtotal_amount+platform_fee_amount+tax_amount;", "quote never references an undeclared subtotal variable");
  includes(quotePatch, "public.create_fuel_commercial_quote(uuid,text,jsonb)", "correction targets the existing quote function");
  includes(quotePatch, "correct_formula", "correction is safe for databases that already have the fixed function");
});

Deno.test("customers see settlement and rental-deposit status from persisted server evidence", () => {
  includes(customerScreen, 'firstString(order, ["settlement_execution_id"])', "customer screen reads the posted settlement execution");
  includes(customerScreen, 'firstString(order, ["settlement_transaction_id"])', "customer screen reads the financial transaction");
  includes(customerScreen, 'firstString(order, ["settlement_statement_id"])', "customer screen reads the station statement");
  includes(customerScreen, 'firstString(order, ["deposit_refunded_at"])', "customer screen reads the actual deposit refund timestamp");
  includes(customerScreen, 'firstNumber(order, ["deposit_refund_amount"])', "customer screen distinguishes a zero deposit from a pending refund");
  includes(customerScreen, "Returned to your SKIMA wallet", "customer receives a clear wallet refund confirmation");
  includes(customerScreen, 'stage==="completed"', "customer distinguishes a completed zero-deposit rental from a pending deposit");
});

Deno.test("the Fuel operation read model exposes posted settlement evidence", () => {
  includes(gateway, "settlement_execution_id,settlement_transaction_id,settlement_statement_id,settled_at,deposit_refund_amount,deposit_refunded_at", "operation read exposes settlement and deposit-return references");
});
