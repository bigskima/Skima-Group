import { createClient } from "npm:@supabase/supabase-js@2.110.9";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "GET") return verifyWebhook(request);
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const appSecret = Deno.env.get("SKIMA_WHATSAPP_APP_SECRET");
  const accessToken = Deno.env.get("SKIMA_WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("SKIMA_WHATSAPP_PHONE_NUMBER_ID");
  const graphVersion = Deno.env.get("SKIMA_WHATSAPP_GRAPH_API_VERSION");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!appSecret || !accessToken || !phoneNumberId || !graphVersion || !supabaseUrl || !serviceRoleKey) {
    return json({ ok: false, error: "whatsapp_provider_not_configured" }, 503);
  }
  if (!/^v\d+\.\d+$/.test(graphVersion)) {
    return json({ ok: false, error: "invalid_graph_api_version_configuration" }, 500);
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!signature || !await verifySignature(appSecret, rawBody, signature)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = readRecord(JSON.parse(rawBody), "payload");
  } catch {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }

  const messages = extractMessages(payload);
  if (messages.length === 0) return json({ ok: true, accepted: 0 });

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  let accepted = 0;

  for (const item of messages) {
    const sender = item.from;
    const messageId = item.id;
    if (!sender || !messageId) continue;

    const contactResult = await db.from("skima_whatsapp_contacts")
      .upsert({
        whatsapp_wa_id: sender,
        last_inbound_at: new Date().toISOString(),
      }, { onConflict: "whatsapp_wa_id", ignoreDuplicates: false })
      .select("id, link_status")
      .single();

    if (contactResult.error || !contactResult.data) {
      return json({ ok: false, error: "contact_persistence_failed" }, 500);
    }

    const eventResult = await db.from("skima_whatsapp_events").insert({
      provider_message_id: messageId,
      contact_id: contactResult.data.id,
      event_type: "message",
      processing_status: "received",
      inbound_payload: {
        type: item.type,
        hasText: Boolean(item.text),
        // Do not persist raw customer messages or one-time account-link codes in webhook logs.
        timestamp: item.timestamp ?? null,
      },
    }).select("id").maybeSingle();

    let eventId: string;
    if (eventResult.error?.code === "23505") {
      // Meta can retry after an outbound failure. Retry failed events, but never duplicate a successful reply.
      const existingEvent = await db.from("skima_whatsapp_events")
        .select("id, processing_status")
        .eq("provider_message_id", messageId)
        .maybeSingle();
      if (existingEvent.error || !existingEvent.data) {
        return json({ ok: false, error: "event_persistence_failed" }, 500);
      }
      if (existingEvent.data.processing_status === "processed") continue;
      const resetEvent = await db.from("skima_whatsapp_events")
        .update({ processing_status: "received", error_message: null, processed_at: null })
        .eq("id", existingEvent.data.id);
      if (resetEvent.error) return json({ ok: false, error: "event_retry_reset_failed" }, 500);
      eventId = existingEvent.data.id;
    } else {
      if (eventResult.error || !eventResult.data) {
        return json({ ok: false, error: "event_persistence_failed" }, 500);
      }
      eventId = eventResult.data.id;
    }

    const conversationResult = await db.from("skima_whatsapp_conversations")
      .upsert({
        contact_id: contactResult.data.id,
        last_message_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: "contact_id" })
      .select("id, state_key, state")
      .single();

    if (conversationResult.error || !conversationResult.data) {
      await markEventFailed(db, eventId, "conversation_persistence_failed");
      return json({ ok: false, error: "conversation_persistence_failed" }, 500);
    }

    let currentLinkStatus = contactResult.data.link_status;
    let linkCodeAccepted = false;
    let linkCodeRejected = false;
    const candidateCode = (item.text ?? "").trim();
    if (currentLinkStatus !== "linked" && /^[A-Fa-f0-9]{16}$/.test(candidateCode)) {
      const linkResult = await db.rpc("consume_skima_whatsapp_link_code", {
        target_code: candidateCode,
        target_whatsapp_wa_id: sender,
      });
      if (linkResult.error) {
        await markEventFailed(db, eventId, "account_link_verification_failed");
        return json({ ok: false, error: "account_link_verification_failed" }, 500);
      }
      linkCodeAccepted = linkResult.data === true;
      linkCodeRejected = !linkCodeAccepted;
      if (linkCodeAccepted) currentLinkStatus = "linked";
    }

    const reply = linkCodeAccepted
      ? buildCustomerReply({ type: "text", text: "menu" }, "linked")
      : linkCodeRejected
        ? "That account-linking code is invalid, expired, or already used. In the SKIMA app, generate a new code and send it here. Codes expire after 10 minutes."
        : buildCustomerReply(item, currentLinkStatus);
    const sendResult = await sendWhatsAppText({
      accessToken, graphVersion, phoneNumberId, recipient: sender, text: reply,
    });

    if (!sendResult.ok) {
      await markEventFailed(db, eventId, sendResult.error);
      return json({ ok: false, error: "outbound_message_failed" }, 502);
    }

    await db.from("skima_whatsapp_conversations")
      .update({ state_key: reply.startsWith("Welcome") ? "menu" : conversationResult.data.state_key })
      .eq("id", conversationResult.data.id);
    await db.from("skima_whatsapp_events")
      .update({ processing_status: "processed", processed_at: new Date().toISOString() })
      .eq("id", eventId);

    accepted += 1;
  }

  return json({ ok: true, accepted });
});

function verifyWebhook(request: Request): Response {
  const verifyToken = Deno.env.get("SKIMA_WHATSAPP_VERIFY_TOKEN");
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (verifyToken && mode === "subscribe" && token === verifyToken && challenge) {
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return json({ ok: false, error: "webhook_verification_failed" }, 403);
}

function extractMessages(payload: Record<string, unknown>): Array<{
  from: string; id: string; type: string; text?: string; timestamp?: string;
}> {
  const result: Array<{ from: string; id: string; type: string; text?: string; timestamp?: string }> = [];
  const entry = Array.isArray(payload.entry) ? payload.entry : [];
  for (const rawEntry of entry) {
    if (!isRecord(rawEntry)) continue;
    const changes = Array.isArray(rawEntry.changes) ? rawEntry.changes : [];
    for (const rawChange of changes) {
      if (!isRecord(rawChange) || !isRecord(rawChange.value)) continue;
      const value = rawChange.value;
      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const rawMessage of messages) {
        if (!isRecord(rawMessage) || typeof rawMessage.from !== "string" || typeof rawMessage.id !== "string") continue;
        const type = typeof rawMessage.type === "string" ? rawMessage.type : "unknown";
        const textBody = type === "text" && isRecord(rawMessage.text) && typeof rawMessage.text.body === "string"
          ? rawMessage.text.body : undefined;
        result.push({
          from: rawMessage.from,
          id: rawMessage.id,
          type,
          text: textBody,
          timestamp: typeof rawMessage.timestamp === "string" ? rawMessage.timestamp : undefined,
        });
      }
    }
  }
  return result;
}

function buildCustomerReply(
  message: { type: string; text?: string },
  linkStatus: string,
): string {
  const input = (message.text ?? "").trim().toLowerCase();
  if (linkStatus !== "linked") {
    return [
      "Welcome to SKIMA LPG 👋",
      "",
      "I can help you order a refill, fund your SKIMA wallet, pay for an order and check delivery status.",
      "To protect your wallet and orders, your WhatsApp number must first be securely linked to your SKIMA account.",
      "",
      "Reply MENU to see this menu again, or HELP for account-linking support.",
      "",
      "To link your account: open the SKIMA app, go to Account > WhatsApp linking, generate a one-time code, then send that code here. It expires after 10 minutes.",
    ].join("\n");
  }

  if (["hi", "hello", "hey", "menu", "start"].includes(input)) {
    return [
      "Welcome back to SKIMA LPG 👋",
      "",
      "Reply with a number:",
      "1 — Order an LPG refill",
      "2 — Fund my SKIMA wallet",
      "3 — Pay for an order",
      "4 — Check my orders",
      "5 — Get help",
    ].join("\n");
  }
  if (input === "1" || input.includes("order")) {
    return "Let's get your refill started. The next step is to connect this chat to SKIMA's live cylinder, location, quote and order services. No order will be created until you review the real quote and confirm it.";
  }
  if (input === "2" || input.includes("fund") || input.includes("top up")) {
    return "Wallet funding uses SKIMA's existing payment provider. I will only report funds as available after SKIMA verifies the payment; please don't send card, bank PIN or OTP details in this chat.";
  }
  if (input === "3" || input.includes("pay")) {
    return "Order payments must use SKIMA's verified wallet/payment flow. I won't accept payment screenshots as proof of payment.";
  }
  if (input === "4" || input.includes("status") || input.includes("track")) {
    return "I can show order status after this chat is securely linked to your SKIMA account and connected to the live order tracking service.";
  }
  if (input === "5" || input.includes("help") || input.includes("support")) {
    return "SKIMA LPG support: please describe the issue. Never send your password, wallet PIN, card details or payment OTP in WhatsApp.";
  }
  return "I didn't recognise that choice. Reply MENU to see the SKIMA LPG customer options, or HELP for support.";
}

async function sendWhatsAppText(args: {
  accessToken: string; graphVersion: string; phoneNumberId: string; recipient: string; text: string;
}): Promise<{ ok: boolean; error: string }> {
  const response = await fetch(
    `https://graph.facebook.com/${args.graphVersion}/${args.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${args.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: args.recipient,
        type: "text",
        text: { preview_url: false, body: args.text },
      }),
    },
  );
  if (response.ok) return { ok: true, error: "" };
  const body = (await response.text()).slice(0, 500);
  return { ok: false, error: `Meta Graph API returned ${response.status}: ${body}` };
}

async function markEventFailed(db: ReturnType<typeof createClient>, id: string, error: string): Promise<void> {
  await db.from("skima_whatsapp_events")
    .update({ processing_status: "failed", error_message: error.slice(0, 1000) })
    .eq("id", id);
}

async function verifySignature(secret: string, rawBody: string, supplied: string): Promise<boolean> {
  const match = /^sha256=([a-f0-9]{64})$/i.exec(supplied);
  if (!match) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = Array.from(signature).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(expected.toLowerCase(), match[1].toLowerCase());
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function readRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  return value;
}
function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
