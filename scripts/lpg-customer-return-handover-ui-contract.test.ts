const scan = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/ScanWorkspaceScreen.tsx");
const customer = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/CustomerOrdersScreen.tsx");
const verification = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/DeliveryVerificationScreen.tsx");

function includes(source: string, value: string, message: string): void {
  if (!source.includes(value)) throw new Error(`${message}: missing "${value}"`);
}

function excludes(source: string, value: string, message: string): void {
  if (source.includes(value)) throw new Error(`${message}: unexpected "${value}"`);
}

Deno.test("driver scan workspace keeps handover cards readable on narrow screens", () => {
  includes(scan, 'tagNoticeCard: { flexDirection: "column"', "handover card uses a vertical mobile layout");
  includes(scan, 'tagNoticeCopy: { width: "100%", minWidth: 0', "order and cylinder details get the full card width");
  includes(scan, 'label="Open hand-over details"', "driver can open the assigned handover workflow");
  includes(scan, "No final driver scan is needed", "return-stage scanner is informational, not an extra scan action");
});

Deno.test("customer can confirm delivery with OTP from the return stage without a second driver scan", () => {
  includes(customer, "const deliveryConfirmationStage = DELIVERY_CONFIRMATION_STATES.has(normalized)", "customer handover is based on the order's return stage");
  includes(customer, "const canVerifyDelivery = deliveryConfirmationStage", "customer OTP action is not gated by a returned-cylinder scan");
  includes(customer, '"return_en_route"', "the customer action becomes available when the return journey starts");
  includes(customer, 'label="Confirm delivery with OTP"', "customer sees the OTP action explicitly");
  includes(verification, "deliveryStageReady", "OTP screen validates the order's delivery stage");
  includes(verification, '["return_en_route", "delivery_verification_pending"].includes(currentOrderStatus)', "OTP can be requested only after the return journey begins");
  includes(verification, "I have received the cylinder — get OTP", "customer confirms physical receipt before requesting the code");
  includes(verification, 'path: "/lpg/orders/delivery-challenge"', "customer requests an order-specific delivery challenge");
  includes(verification, 'action: "verify"', "customer OTP confirmation completes the handover");
  excludes(customer, "customerReturnScanVerified", "customer action no longer depends on a final driver scan");
  excludes(customer, "hasVerifiedCustomerDeliveryScan", "customer order list no longer reads a return-scan flag");
  excludes(verification, "returnCylinderScanVerified", "OTP screen no longer requires a final driver scan");
  excludes(verification, "Waiting for returned-cylinder scan", "customer is not instructed to wait for a duplicate scan");
});
