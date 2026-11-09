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
  assertIncludes(webhook, 'stage === "menu" && normalized === "6"');
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
