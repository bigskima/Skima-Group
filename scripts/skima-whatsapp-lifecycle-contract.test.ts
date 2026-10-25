const root = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

Deno.test("WhatsApp channel connects to the canonical LPG lifecycle", async () => {
  const [webhook, foundation, lifecycle] = await Promise.all([
    read("supabase/functions/skima-whatsapp-webhook/index.ts"),
    read("supabase/migrations/20261025090000_skima_customer_whatsapp_channel.sql"),
    read("supabase/migrations/20261025190000_skima_whatsapp_lpg_order_lifecycle.sql"),
  ]);
  assertIncludes(webhook, 'db.rpc("read_skima_whatsapp_customer_choices"');
  assertIncludes(webhook, 'db.rpc("read_skima_whatsapp_eligible_stations"');
  assertIncludes(webhook, 'db.rpc("create_skima_whatsapp_lpg_quote"');
  assertIncludes(webhook, 'db.rpc("create_skima_whatsapp_lpg_order"');
  assertIncludes(webhook, 'db.rpc("reserve_and_dispatch_lpg_refill_order"');
  assertIncludes(webhook, 'eq("customer_user_id", profileId)');
  assertIncludes(webhook, 'eq("payment_status", "pending")');
  assertIncludes(webhook, "No payment is taken by generating this quote.");
  assertIncludes(webhook, "verifySignature(appSecret, rawBody, signature)");
  assertNotIncludes(webhook, "next step is to connect this chat to SKIMA's live");
  assertIncludes(foundation, "consume_skima_whatsapp_link_code");
  assertIncludes(foundation, "code_hash");
  assertIncludes(foundation, "link_attempt_count");
  assertIncludes(lifecycle, "read_lpg_eligible_stations");
  assertIncludes(lifecycle, "public.create_lpg_refill_quote(");
  assertIncludes(lifecycle, "public.create_lpg_refill_order(");
  assertIncludes(lifecycle, "from public, anon, authenticated");
  assertIncludes(lifecycle, "to service_role");
});

function assertIncludes(source: string, fragment: string): void {
  if (!source.includes(fragment)) throw new Error(`Expected source to include: ${fragment}`);
}
function assertNotIncludes(source: string, fragment: string): void {
  if (source.includes(fragment)) throw new Error(`Expected source not to include: ${fragment}`);
}
