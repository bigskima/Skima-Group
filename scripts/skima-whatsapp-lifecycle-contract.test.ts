const root = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

Deno.test("WhatsApp channel connects to the canonical LPG lifecycle", async () => {
  const [webhook, gateway, foundation, lifecycle, notifications, config] = await Promise.all([
    read("supabase/functions/skima-whatsapp-webhook/index.ts"),
    read("supabase/functions/api-gateway/index.ts"),
    read("supabase/migrations/20261026001000_skima_customer_whatsapp_channel.sql"),
    read("supabase/migrations/20261026002000_skima_whatsapp_lpg_order_lifecycle.sql"),
    read("supabase/migrations/20261026003000_skima_whatsapp_order_status_notifications.sql"),
    read("supabase/config.toml"),
  ]);

  // WhatsApp collects choices only from the linked customer's own records.
  assertIncludes(webhook, 'db.rpc("read_skima_whatsapp_customer_choices"');
  assertIncludes(webhook, 'db.rpc("read_skima_whatsapp_eligible_stations"');
  assertIncludes(webhook, 'db.rpc("create_skima_whatsapp_lpg_order"');
  assertIncludes(webhook, 'db.rpc("reserve_and_dispatch_lpg_refill_order"');
  assertIncludes(webhook, 'eq("customer_user_id", profileId)');
  assertIncludes(webhook, 'eq("payment_status", "pending")');
  assertIncludes(webhook, "No payment is taken by generating this quote.");
  assertIncludes(webhook, "verifySignature(appSecret, rawBody, signature)");
  assertIncludes(webhook, "requestCanonicalQuote(");
  assertIncludes(webhook, "_lastReplyText");
  assertIncludes(webhook, 'db.rpc("set_skima_whatsapp_order_notifications"');
  assertIncludes(webhook, 'stage === "menu" && normalized === "0"');
  assertIncludes(webhook, 'eq("order_status_notifications_opt_in", true)');
  assertIncludes(webhook, 'db.rpc("skima_whatsapp_create_support_thread"');
  assertIncludes(webhook, 'db.rpc("skima_whatsapp_reply_support_thread"');
  assertIncludes(webhook, 'db.rpc("skima_whatsapp_agent_reply_support_thread"');
  assertIncludes(webhook, 'db.rpc("skima_whatsapp_claim_support_thread"');
  assertIncludes(webhook, 'db.rpc("claim_skima_whatsapp_support_outbox"');
  assertIncludes(webhook, 'dispatchWhatsAppOutboxes(request)');
  assertIncludes(webhook, 'supportStatusResult');
  assertIncludes(webhook, 'target_is_internal: command === "NOTE"');
  const supportConsentGuard = webhook.indexOf('const consentResult = await db.from("skima_whatsapp_contacts")');
  const supportOrderSend = webhook.indexOf("const result = await sendWhatsAppTemplate", supportConsentGuard);
  if (supportConsentGuard < 0 || supportOrderSend <= supportConsentGuard) {
    throw new Error("Order notification consent must be rechecked before every provider send.");
  }

  const supportMigration = await read("supabase/migrations/20261109120000_skima_whatsapp_support_handoff.sql");
  assertIncludes(supportMigration, "create table if not exists public.skima_whatsapp_support_outbox");
  assertIncludes(supportMigration, "public.create_support_app_thread(");
  assertIncludes(supportMigration, "public.reply_to_my_support_app_thread(");
  assertIncludes(supportMigration, "public.respond_to_support_app_thread(");
  assertIncludes(supportMigration, "public.assign_support_app_thread(");
  assertIncludes(supportMigration, "or coalesce(new.is_internal,false)");
  assertIncludes(supportMigration, "interval '24 hours'");
  assertIncludes(supportMigration, "for update of n skip locked");
  assertIncludes(supportMigration, "to service_role");
  const historyPolicy = JSON.parse(await read("supabase/migration-history-policy.json")) as {
    businessModuleMigrations: string[];
  };
  if (!historyPolicy.businessModuleMigrations.includes("20261109120000_skima_whatsapp_support_handoff.sql")) {
    throw new Error("WhatsApp support handoff migration must be tracked in migration-history-policy.json.");
  }
  const consentGuardIndex = webhook.indexOf('const consentResult = await db.from("skima_whatsapp_contacts")');
  const notificationSendIndex = webhook.indexOf("const result = await sendWhatsAppTemplate", consentGuardIndex);
  if (consentGuardIndex < 0 || notificationSendIndex <= consentGuardIndex) {
    throw new Error("Notification consent must be rechecked before every provider send.");
  }
  assertIncludes(webhook, "SKIMA_WHATSAPP_DISPATCH_SECRET");
  assertIncludes(webhook, "sendWhatsAppTemplate");
  assertIncludes(webhook, "extractStatuses");
  assertIncludes(webhook, "Reply STOP at any time");
  assertNotIncludes(webhook, "next step is to connect this chat to SKIMA's live");

  // Quotes must use the same commercial route/pricing path as the app, not a local price calculation.
  assertIncludes(gateway, 'routePath === "/internal/whatsapp/lpg/quote"');
  assertIncludes(gateway, 'buildLpgCommercialRouteSnapshot(');
  assertIncludes(gateway, 'serviceClient.rpc("create_skima_whatsapp_lpg_quote"');

  assertIncludes(foundation, "consume_skima_whatsapp_link_code");
  assertIncludes(foundation, "code_hash");
  assertIncludes(foundation, "link_attempt_count");

  assertIncludes(lifecycle, "read_lpg_eligible_stations");
  assertIncludes(lifecycle, "public.create_lpg_refill_quote_from_purchase_input(");
  assertIncludes(lifecycle, "public.create_lpg_refill_order(");
  assertIncludes(lifecycle, "from public, anon, authenticated");
  assertIncludes(lifecycle, "to service_role");

  // Proactive notifications must be consent-based and delivered from the same canonical order rows.
  assertIncludes(notifications, "order_status_notifications_opt_in boolean not null default false");
  assertIncludes(notifications, "queue_skima_whatsapp_order_status_notification");
  assertIncludes(notifications, "claim_skima_whatsapp_order_notifications");
  assertIncludes(notifications, "cron.schedule(");
  assertIncludes(notifications, "skima_whatsapp_dispatch_secret");
  assertIncludes(config, "[functions.skima-whatsapp-webhook]");
  assertIncludes(config, "verify_jwt = false");
});

function assertIncludes(source: string, fragment: string): void {
  if (!source.includes(fragment)) throw new Error(`Expected source to include: ${fragment}`);
}
function assertNotIncludes(source: string, fragment: string): void {
  if (source.includes(fragment)) throw new Error(`Expected source not to include: ${fragment}`);
}


Deno.test("WhatsApp ordering reuses the live Fuel, Bills, Logistics and Store domain lifecycles", async () => {
  const [webhook, ordering, fuel, logistics, utility, store, historyText] = await Promise.all([
    read("supabase/functions/skima-whatsapp-webhook/index.ts"),
    read("supabase/migrations/20261109153000_skima_whatsapp_four_app_ordering.sql"),
    read("supabase/migrations/20261101202600_fuel_order_creation_and_driver_qualification.sql"),
    read("supabase/migrations/20261103143845_logistics_booking_and_payment_modes.sql"),
    read("supabase/migrations/20260909033000_utility_financial_fulfillment_runtime.sql"),
    read("supabase/migrations/20261102112220_skima_store_foundation.sql"),
    read("supabase/migration-history-policy.json"),
  ]);

  // Customer-facing state machines must exist for each service; all order creation
  // and payment confirmation is routed through linked-account guarded database wrappers.
  for (const stage of [
    'stage === "fuel.product"',
    'stage === "fuel.station"',
    'stage === "fuel.confirm"',
    'stage === "bills.product"',
    'stage === "bills.identifier"',
    'stage === "bills.confirm"',
    'stage === "logistics.category"',
    'stage === "logistics.pickup.address"',
    'stage === "logistics.destination.address"',
    'stage === "logistics.offer.select"',
    'stage === "logistics.booking.confirm"',
    'stage === "store.product"',
    'stage === "store.payment"',
  ]) assertIncludes(webhook, stage);

  assertIncludes(webhook, 'db.rpc("skima_whatsapp_create_fuel_order"');
  assertIncludes(webhook, 'db.rpc("skima_whatsapp_pay_fuel_order"');
  assertIncludes(webhook, 'db.rpc("read_utility_catalog"');
  assertIncludes(webhook, "validateUtilityCustomer(db");
  assertIncludes(webhook, 'db.rpc("skima_whatsapp_create_utility_payment"');
  assertIncludes(webhook, 'db.rpc("search_logistics_geographies"');
  assertIncludes(webhook, 'db.rpc("skima_whatsapp_create_logistics_job"');
  assertIncludes(webhook, 'db.rpc("skima_whatsapp_create_logistics_booking"');
  assertIncludes(webhook, 'db.rpc("skima_whatsapp_pay_logistics_booking"');
  assertIncludes(webhook, 'db.rpc("skima_whatsapp_store_checkout"');
  assertIncludes(webhook, "readWhatsAppStoreCatalogue(db)");
  assertIncludes(webhook, "readWhatsAppLogisticsOffers(db, profileId");
  assertIncludes(webhook, 'eq("requester_user_id", profileId)');
  assertIncludes(webhook, 'Reply 8 again for fresh status');

  // Fuel must use the same quote/accept/wallet reservation engine as the app.
  assertIncludes(fuel, "public.create_fuel_order_with_quote(");
  assertIncludes(fuel, "public.create_fuel_commercial_quote(");
  assertIncludes(ordering, "public.create_fuel_order_with_quote(");
  assertIncludes(ordering, "public.accept_price_quote(");
  assertIncludes(ordering, "public.fund_order_from_wallet(");

  // Bills must use live catalogue/provider validation and the existing utility hold.
  assertIncludes(ordering, "public.create_utility_payment_request(");
  assertIncludes(ordering, "public.reserve_utility_payment_request(");
  assertIncludes(utility, "create or replace function public.reserve_utility_payment_request");

  // Logistics requests, offer booking, online-wallet escrow and safe cancellation
  // must remain the shared logistics network's canonical domain operations.
  assertIncludes(ordering, "public.create_logistics_job(");
  assertIncludes(ordering, "public.create_logistics_booking_for_offer(");
  assertIncludes(ordering, "public.reserve_logistics_booking_online_payment(");
  assertIncludes(ordering, "public.cancel_logistics_booking_before_payment(");
  assertIncludes(logistics, "create or replace function public.create_logistics_booking_for_offer");

  // Store checkout uses shared catalogue pricing/stock checks and the common ledger.
  assertIncludes(ordering, "public.create_order_from_catalog(");
  assertIncludes(ordering, "public.fund_order_from_wallet(");
  assertIncludes(ordering, "store_checkout_snapshot");
  assertIncludes(store, "'store.order.acceptance.manual.v1'");
  assertIncludes(ordering, "target_confirm_payment");
  assertIncludes(ordering, "linked customer''s request");
  // Wallet discovery must not depend on a balance-view row existing yet.
  assertIncludes(webhook, 'db.from("wallet_accounts")');
  assertIncludes(webhook, 'db.from("wallet_balances")');
  // Store accepts owned saved street addresses even when map coordinates are absent.
  assertIncludes(webhook, 'db.from("lpg_customer_locations")');
  assertIncludes(webhook, '.eq("owner_user_id", profileId)');
  assertIncludes(webhook, '.eq("status", "active")');
  assertIncludes(webhook, 'asText(location.formatted_address, "")');

  assertIncludes(ordering, "from public,anon,authenticated");
  assertIncludes(ordering, "to service_role");
  assertIncludes(ordering, "public.has_accepted_current_policy('policy.customer.terms',null)");
  assertIncludes(ordering, "public.has_accepted_current_policy('policy.customer.bills.terms',null)");
  assertIncludes(ordering, "public.has_accepted_current_policy('policy.customer.logistics.terms',null)");
  assertIncludes(ordering, "public.has_accepted_current_policy('policy.customer.store.terms',null)");
  const history = JSON.parse(historyText) as { businessModuleMigrations: string[] };
  if (!history.businessModuleMigrations.includes("20261109153000_skima_whatsapp_four_app_ordering.sql")) {
    throw new Error("The four-app WhatsApp ordering migration must be tracked in migration-history-policy.json.");
  }
});
