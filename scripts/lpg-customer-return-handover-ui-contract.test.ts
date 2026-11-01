const scan = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/ScanWorkspaceScreen.tsx");
const customer = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/CustomerOrdersScreen.tsx");
const verification = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/DeliveryVerificationScreen.tsx");

function includes(source: string, value: string, message: string): void {
  if (!source.includes(value)) throw new Error(`${message}: missing "${value}"`);
}

Deno.test("driver scan workspace keeps returned-cylinder handover cards readable on narrow screens", () => {
  includes(scan, 'tagNoticeCard: { flexDirection: "column"', "handover card uses a vertical mobile layout");
  includes(scan, 'tagNoticeCopy: { width: "100%", minWidth: 0', "order and cylinder details get the full card width");
  includes(scan, 'label="Open hand-over details"', "driver can open the assigned handover workflow");
  includes(scan, 'fullWidth', "handover action spans the card below its content");
});

Deno.test("customer delivery confirmation becomes ready after the returned-cylinder scan, not before", () => {
  includes(customer, 'const customerReturnScanVerified = hasVerifiedCustomerDeliveryScan(root, order)', "customer screen reads the per-order return scan");
  includes(customer, "const canVerifyDelivery = deliveryConfirmationStage && customerReturnScanVerified", "customer CTA requires a passed return scan in an eligible delivery stage");
  includes(customer, '? "delivery_verification_pending"', "customer sees Ready for hand-over after the physical scan");
  includes(customer, 'scanType === "customer_delivery" && result === "passed"', "only the passed customer-delivery scan unlocks the action");
  includes(verification, "customerDeliveryScanVerified === true", "OTP screen consumes the server read-model readiness flag");
  includes(verification, 'String(scan.scanType ?? scan.scan_type ?? "").toLowerCase() === "customer_delivery"', "OTP screen supports both camelCase and database scan fields");
  includes(verification, 'String(scan.result ?? "").toLowerCase() === "passed"', "OTP screen requires a passed scan result");
});
