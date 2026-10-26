import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.9";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const MENU = [
  "Welcome to SKIMA LPG 👋",
  "",
  "Reply with a number:",
  "1 — Order an LPG refill",
  "2 — Fund my SKIMA wallet",
  "3 — Pay / retry a pending order",
  "4 — Check and track my orders",
  "5 — Get help",
  "6 — Enable order status notifications",
].join("\n");

type InboundMessage = {
  from: string;
  id: string;
  type: string;
  text?: string;
  timestamp?: string;
};
type Conversation = { id: string; state_key: string; state: Record<string, unknown> };
type ReplyPlan = { text: string; stateKey: string; state: Record<string, unknown> };
type ProviderDeliveryStatus = {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp?: string;
  errorCode?: string;
};

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "GET") return verifyWebhook(request);
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (new URL(request.url).searchParams.get("mode") === "dispatch") {
    return await dispatchOrderStatusNotifications(request);
  }

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
  const statuses = extractStatuses(payload);
  if (messages.length === 0 && statuses.length === 0) return json({ ok: true, accepted: 0, statusesRecorded: 0 });

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  let statusesRecorded = 0;
  for (const status of statuses) {
    const providerTime = status.timestamp && /^\d+$/.test(status.timestamp)
      ? new Date(Number(status.timestamp) * 1000).toISOString()
      : new Date().toISOString();
    const statusResult = await db.from("skima_whatsapp_order_notifications")
      .update({
        provider_delivery_status: status.status,
        provider_status_at: providerTime,
        provider_error_code: status.errorCode ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("provider_message_id", status.id)
      .select("id")
      .maybeSingle();
    if (statusResult.error) {
      return json({ ok: false, error: "delivery_status_persistence_failed" }, 500);
    }
    if (statusResult.data) statusesRecorded += 1;
  }
  if (messages.length === 0) return json({ ok: true, accepted: 0, statusesRecorded });
  let accepted = 0;

  for (const item of messages) {
    const sender = item.from;
    if (!sender || !item.id) continue;

    const contactResult = await db.from("skima_whatsapp_contacts")
      .upsert({
        whatsapp_wa_id: sender,
        last_inbound_at: new Date().toISOString(),
      }, { onConflict: "whatsapp_wa_id", ignoreDuplicates: false })
      .select("id, link_status, profile_id")
      .single();
    if (contactResult.error || !contactResult.data) {
      return json({ ok: false, error: "contact_persistence_failed" }, 500);
    }

    const eventResult = await db.from("skima_whatsapp_events").insert({
      provider_message_id: item.id,
      contact_id: contactResult.data.id,
      event_type: "message",
      processing_status: "received",
      inbound_payload: {
        type: item.type,
        hasText: Boolean(item.text),
        // Never persist the raw message or an account-link code.
        timestamp: item.timestamp ?? null,
      },
    }).select("id").maybeSingle();

    let eventId: string;
    let shouldReplaySavedReply = false;
    if (eventResult.error?.code === "23505") {
      // Meta retries are idempotent. Do not answer a previously successful delivery twice.
      const existingEvent = await db.from("skima_whatsapp_events")
        .select("id, processing_status")
        .eq("provider_message_id", item.id)
        .maybeSingle();
      if (existingEvent.error || !existingEvent.data) {
        return json({ ok: false, error: "event_persistence_failed" }, 500);
      }
      if (existingEvent.data.processing_status === "processed") continue;
      shouldReplaySavedReply = true;
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

    if (shouldReplaySavedReply) {
      const saved = asRecord(conversationResult.data.state);
      if (saved._lastInboundMessageId === item.id && typeof saved._lastReplyText === "string" && saved._lastReplyText) {
        const replaySend = await sendWhatsAppText({
          accessToken, graphVersion, phoneNumberId, recipient: sender, text: saved._lastReplyText,
        });
        if (!replaySend.ok) {
          await markEventFailed(db, eventId, replaySend.error);
          return json({ ok: false, error: "outbound_message_failed" }, 502);
        }
        await db.from("skima_whatsapp_events")
          .update({ processing_status: "processed", processed_at: new Date().toISOString() })
          .eq("id", eventId);
        accepted += 1;
        continue;
      }
    }

    let contact = contactResult.data;
    const candidateCode = (item.text ?? "").trim();
    let linkCodeAccepted = false;
    let linkCodeRejected = false;
    if (contact.link_status !== "linked" && /^[A-Fa-f0-9]{16}$/.test(candidateCode)) {
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
      if (linkCodeAccepted) {
        const refreshedContact = await db.from("skima_whatsapp_contacts")
          .select("id, link_status, profile_id")
          .eq("whatsapp_wa_id", sender)
          .maybeSingle();
        if (refreshedContact.error || !refreshedContact.data) {
          await markEventFailed(db, eventId, "account_link_refresh_failed");
          return json({ ok: false, error: "account_link_refresh_failed" }, 500);
        }
        contact = refreshedContact.data;
      }
    }

    let plan: ReplyPlan;
    if (linkCodeAccepted) {
      plan = { text: MENU, stateKey: "menu", state: {} };
    } else if (linkCodeRejected) {
      plan = {
        text: "That account-linking code is invalid, expired, or already used. In the SKIMA app, generate a new code and send it here. Codes expire after 10 minutes.",
        stateKey: "menu",
        state: {},
      };
    } else if (contact.link_status !== "linked" || !contact.profile_id) {
      plan = {
        text: [
          "Welcome to SKIMA LPG 👋",
          "",
          "Securely link this chat to your existing SKIMA account before viewing orders or using wallet-related features.",
          "",
          "Open SKIMA app → Account → WhatsApp linking → Generate linking code, then send the 16-character code here. It expires after 10 minutes.",
          "",
          "Never send your password, wallet PIN, payment OTP or card details in WhatsApp.",
        ].join("\n"),
        stateKey: "menu",
        state: {},
      };
    } else {
      try {
        plan = await handleLinkedMessage(db, sender, contact.profile_id, conversationResult.data as Conversation, item);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown";
        console.error(JSON.stringify({ event: "whatsapp_message_processing_failed", providerMessageId: item.id, code: classifyError(message) }));
        plan = {
          text: "SKIMA couldn't complete that step right now. No payment is confirmed unless SKIMA says it was reserved. Reply MENU to restart, or try again in a moment.",
          stateKey: conversationResult.data.state_key,
          state: asRecord(conversationResult.data.state),
        };
      }
    }

    const stateResult = await db.from("skima_whatsapp_conversations")
      .update({
        state_key: plan.stateKey,
        state: { ...plan.state, _lastInboundMessageId: item.id, _lastReplyText: plan.text },
        last_message_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq("id", conversationResult.data.id);
    if (stateResult.error) {
      await markEventFailed(db, eventId, "conversation_state_update_failed");
      return json({ ok: false, error: "conversation_state_update_failed" }, 500);
    }

    const sendResult = await sendWhatsAppText({
      accessToken,
      graphVersion,
      phoneNumberId,
      recipient: sender,
      text: plan.text,
    });
    if (!sendResult.ok) {
      await markEventFailed(db, eventId, sendResult.error);
      return json({ ok: false, error: "outbound_message_failed" }, 502);
    }

    await db.from("skima_whatsapp_events")
      .update({ processing_status: "processed", processed_at: new Date().toISOString() })
      .eq("id", eventId);
    accepted += 1;
  }

  return json({ ok: true, accepted });
});

async function handleLinkedMessage(
  db: SupabaseClient,
  whatsappWaId: string,
  profileId: string,
  conversation: Conversation,
  item: InboundMessage,
): Promise<ReplyPlan> {
  const input = (item.text ?? "").trim();
  const normalized = input.toLowerCase();
  const state = asRecord(conversation.state);
  const stage = conversation.state_key;

  if (!input) return plan("Please send a text response or reply MENU to see the options.", "menu");
  if (["stop", "unsubscribe", "stop notifications", "turn off notifications"].includes(normalized)) {
    const preference = await db.rpc("set_skima_whatsapp_order_notifications", {
      target_whatsapp_wa_id: whatsappWaId,
      target_opt_in: false,
    });
    if (preference.error) throw preference.error;
    return plan("WhatsApp order-status notifications are now off. You can still message SKIMA to check your orders. Reply 6 to opt in again.", "menu");
  }
  if (["cancel", "restart"].includes(normalized)) {
    return plan("Cancelled the current step. No new order was created by that command.\n\n" + MENU, "menu");
  }
  if (["6", "notifications", "order notifications", "enable notifications", "enable order updates"].includes(normalized)) {
    const preference = await db.rpc("set_skima_whatsapp_order_notifications", {
      target_whatsapp_wa_id: whatsappWaId,
      target_opt_in: true,
    });
    if (preference.error) throw preference.error;
    return plan([
      "You are opted in to SKIMA LPG order-status notifications.",
      "",
      "We'll send service updates for your LPG orders, such as payment reservation, dispatch and delivery progress. These are order updates, not marketing messages.",
      "",
      "Reply STOP at any time to turn them off. You can still use MENU to order or check an order.",
    ].join("\n"), "menu");
  }
  if (["menu", "hi", "hello", "hey", "start"].includes(normalized)) return plan(MENU, "menu");

  if (stage === "menu" && (
    ["1", "order", "refill", "order refill", "order a refill"].includes(normalized) ||
    normalized.includes("order refill") ||
    normalized.includes("order an lpg")
  )) {
    const choicesResult = await db.rpc("read_skima_whatsapp_customer_choices", {
      target_whatsapp_wa_id: whatsappWaId,
    });
    if (choicesResult.error) throw choicesResult.error;
    const choices = asRecord(choicesResult.data);
    const cylinders = arrayOfRecords(choices.cylinders);
    const locations = arrayOfRecords(choices.locations);
    if (cylinders.length === 0) {
      return plan("There is no eligible saved LPG cylinder linked to this account. Add or verify a cylinder in SKIMA app, then reply MENU.", "menu");
    }
    if (locations.length === 0) {
      return plan("Add at least one active saved pickup/delivery location with map coordinates in the SKIMA app. Then reply MENU to start a refill.", "menu");
    }
    return plan(
      `Choose the cylinder you want to refill:\\n${cylinders.map((cylinder, index) =>
        `${index + 1}. ${asText(cylinder.displayName, "LPG cylinder")} — capacity ${numberValue(cylinder.maxCapacityKg) ?? "unknown"} kg`
      ).join("\\n")}\\n\\nReply with the number.`,
      "order.cylinder",
      { cylinders, locations },
    );
  }

  if (stage === "order.cylinder") {
    const choices = arrayOfRecords(state.cylinders);
    const selected = selectNumber(input, choices);
    if (!selected) return plan("Reply with the number of the cylinder you want to refill, or MENU to cancel.", stage, state);
    const capacity = numberValue(selected.maxCapacityKg);
    if (!capacity || capacity <= 0) return plan("This cylinder is missing a valid capacity. Update it in the SKIMA app and start again with MENU.", "menu");
    return plan(
      `Cylinder selected: ${asText(selected.displayName, "LPG cylinder")} (${numberValue(selected.sizeKg) ?? capacity} kg cylinder).\n\nHow many kilograms would you like to refill? Enter a number up to ${capacity} kg.`,
      "order.kg",
      { ...state, cylinder: selected },
    );
  }

  if (stage === "order.kg") {
    const kg = Number(input.replace(/\s*kg$/i, "").trim());
    const cylinder = asRecord(state.cylinder);
    const capacity = numberValue(cylinder.maxCapacityKg);
    if (!Number.isFinite(kg) || kg <= 0 || !capacity || kg > capacity) {
      return plan(`Enter a valid amount greater than 0 and no more than ${capacity ?? "the cylinder"} kg.`, stage, state);
    }
    const locations = arrayOfRecords(state.locations);
    if (locations.length === 0) return plan("No active saved locations are available. Add an address with map coordinates in the SKIMA app, then reply MENU.", "menu");
    return plan(
      `Choose the pickup location by number:\n${formatLocations(locations)}`,
      "order.pickup",
      { ...state, requestedKg: kg },
    );
  }

  if (stage === "order.pickup" || stage === "order.delivery") {
    const locations = arrayOfRecords(state.locations);
    const selected = selectNumber(input, locations);
    if (!selected) return plan("Reply with the number of a saved location, or MENU to cancel.", stage, state);
    if (stage === "order.pickup") {
      return plan(
        `Pickup: ${asText(selected.label, "Saved location")}\n\nNow choose the delivery location:\n${formatLocations(locations)}`,
        "order.delivery",
        { ...state, pickupLocationId: selected.id, pickupLabel: selected.label },
      );
    }

    const cylinder = asRecord(state.cylinder);
    const request = {
      target_whatsapp_wa_id: whatsappWaId,
      target_cylinder_id: String(cylinder.id),
      target_requested_kg: numberValue(state.requestedKg),
      target_pickup_location_id: String(state.pickupLocationId),
      target_delivery_location_id: String(selected.id),
    };
    const stationsResult = await db.rpc("read_skima_whatsapp_eligible_stations", request);
    if (stationsResult.error) throw stationsResult.error;
    const stations = arrayOfRecords(stationsResult.data);
    if (stations.length === 0) {
      return plan("SKIMA could not find an approved refill option that can serve both saved locations and the selected cylinder right now. No order has been created. Reply MENU to try different locations or a different amount.", "menu");
    }
    return plan(
      `Choose your refill option:\n${formatStations(stations)}\n\nReply with the number of the option you want.`,
      "order.station",
      {
        cylinder,
        requestedKg: numberValue(state.requestedKg),
        pickupLocationId: state.pickupLocationId,
        pickupLabel: state.pickupLabel,
        deliveryLocationId: selected.id,
        deliveryLabel: selected.label,
        stations,
      },
    );
  }

  if (stage === "order.station") {
    const stations = arrayOfRecords(state.stations);
    const station = selectNumber(input, stations);
    if (!station) return plan("Reply with the number of one of the listed refill options, or MENU to cancel.", stage, state);
    const quote = await requestCanonicalQuote({
      whatsappWaId,
      cylinderId: asText(asRecord(state.cylinder).id, ""),
      requestedKg: numberValue(state.requestedKg),
      pickupLocationId: asText(state.pickupLocationId, ""),
      deliveryLocationId: asText(state.deliveryLocationId, ""),
      stationBranchId: asText(station.station_branch_id, ""),
      fulfillmentMode: asText(station.fulfillmentMode, ""),
      idempotencyKey: await idempotencyKey("quote", item.id),
      providerMessageId: item.id,
    });
    if (!quote.id || !numberValue(quote.totalAmount)) throw new Error("Quote details were not returned by the canonical pricing service.");
    const expires = formatDate(quote.expiresAt);
    return plan(
      [
        "SKIMA quote — please review before confirming",
        "",
        `Refill: ${quote.requestedKg} kg`,
        `Station: ${asText(quote.stationName, asText(station.display_name, "Selected station"))}`,
        `Fulfilment: ${quote.fulfillmentMode === "station_managed" ? "Station Managed" : "SKIMA driver delivery"}`,
        `LPG: ${money(numberValue(quote.lpgAmount) ?? 0, asText(quote.currencyCode, "NGN"))}`,
        `Delivery: ${money(numberValue(quote.deliveryFeeAmount) ?? 0, asText(quote.currencyCode, "NGN"))}`,
        `Platform fees: ${money(numberValue(quote.platformFeeAmount) ?? 0, asText(quote.currencyCode, "NGN"))}`,
        `Tax: ${money(numberValue(quote.taxAmount) ?? 0, asText(quote.currencyCode, "NGN"))}`,
        `TOTAL: ${money(numberValue(quote.totalAmount) ?? 0, asText(quote.currencyCode, "NGN"))}`,
        `Quote expires: ${expires}`,
        "",
        "Reply CONFIRM to create the order and attempt SKIMA wallet reservation, or CANCEL to stop.",
        "No payment is taken by generating this quote.",
      ].join("\n"),
      "order.confirm",
      { quote },
    );
  }

  if (stage === "order.confirm") {
    if (!["confirm", "yes", "confirm order"].includes(normalized)) {
      return plan("Please reply CONFIRM to create the order, or CANCEL to discard this quote.", stage, state);
    }
    const quote = asRecord(state.quote);
    const orderResult = await db.rpc("create_skima_whatsapp_lpg_order", {
      target_whatsapp_wa_id: whatsappWaId,
      target_quote_id: asText(quote.id, ""),
      target_idempotency_key: await idempotencyKey("order", asText(quote.id, item.id)),
      target_provider_message_id: item.id,
    });
    if (orderResult.error) {
      const message = orderResult.error.message ?? "";
      if (/Customer Terms|accept the current SKIMA Customer Terms/i.test(message)) {
        return plan("Before an order can be confirmed, please open SKIMA app and accept the current Customer Terms. Then reply CONFIRM here to continue while this quote is still valid.", stage, state);
      }
      if (/expired|no longer available/i.test(message)) {
        return plan("This quote has expired or the station is no longer eligible. No payment was taken. Reply MENU to get a fresh quote.", "menu");
      }
      throw orderResult.error;
    }
    const order = asRecord(orderResult.data);
    const orderId = asText(order.id, "");
    if (!orderId) throw new Error("Order was not returned by the order service.");

    const payment = await attemptReservation(db, profileId, orderId, item.id);
    if (payment.ok) {
      return plan(
        [
          "✅ SKIMA order funded and sent for dispatch",
          "",
          `Order: ${asText(order.publicReference, orderId)}`,
          `Amount reserved: ${money(numberValue(order.totalAmount) ?? numberValue(asRecord(state.quote).totalAmount) ?? 0, asText(order.currencyCode, "NGN"))}`,
          "SKIMA will update you through the app and this chat when order status changes if you message us.",
          "",
          "Reply 4 to view your orders or MENU for other options.",
        ].join("\n"),
        "menu",
        {},
      );
    }
    return plan(
      [
        "Order created, but payment is still pending.",
        "",
        `Order: ${asText(order.publicReference, orderId)}`,
        `Amount due: ${money(numberValue(order.totalAmount) ?? 0, asText(order.currencyCode, "NGN"))}`,
        payment.message,
        "",
        "Open SKIMA app → Wallet → Top up if needed. After top-up, reply PAY to retry from your existing wallet. Your order has not been marked paid.",
      ].join("\n"),
      "payment.pending",
      { orderId, publicReference: order.publicReference, totalAmount: order.totalAmount, currencyCode: order.currencyCode },
    );
  }

  if (["2", "fund", "top up", "topup", "wallet"].includes(normalized)) {
    return plan(
      "To fund your wallet securely, open the SKIMA app → Wallet → Top up and complete checkout through the payment provider configured in SKIMA. Return here and reply PAY after the funds show in your wallet. This chat cannot accept payment screenshots, card details, bank PINs or OTPs.",
      "menu",
    );
  }

  if (["3", "pay", "retry payment", "payment"].includes(normalized)) {
    const pendingResult = await db.from("lpg_refill_orders")
      .select("id, public_reference, status, payment_status, total_amount, currency_code, created_at")
      .eq("customer_user_id", profileId)
      .eq("payment_status", "pending")
      .order("created_at", { ascending: false })
      .limit(5);
    if (pendingResult.error) throw pendingResult.error;
    const pending = arrayOfRecords(pendingResult.data);
    if (pending.length === 0) {
      return plan("I couldn't find a pending LPG order for your account. If you recently topped up, check the wallet balance in the app first. Reply 4 to check your orders or MENU.", "menu");
    }
    if (pending.length === 1) {
      const onlyOrder = pending[0];
      const payment = await attemptReservation(db, profileId, asText(onlyOrder.id, ""), item.id);
      if (payment.ok) {
        return plan(`✅ Payment reserved. Order ${asText(onlyOrder.public_reference, asText(onlyOrder.id, ""))} is sent for dispatch. Reply 4 to view your orders or MENU for options.`, "menu");
      }
      return plan(`Payment is still pending for ${asText(onlyOrder.public_reference, "your order")}. ${payment.message} After resolving the wallet balance or dispatch issue, reply PAY to try again.`, "payment.pending", { orderId: onlyOrder.id });
    }
    return plan(
      `Select the pending order you want to pay:\n${pending.map((order, index) => `${index + 1}. ${asText(order.public_reference, "LPG order")} — ${money(numberValue(order.total_amount) ?? 0, asText(order.currency_code, "NGN"))}`).join("\n")}\n\nReply with its number.`,
      "payment.select",
      { orders: pending },
    );
  }

  if (stage === "payment.select") {
    const orders = arrayOfRecords(state.orders);
    const selected = selectNumber(input, orders);
    if (!selected) return plan("Reply with the number of one of the pending orders, or CANCEL to return to the menu.", stage, state);
    const payment = await attemptReservation(db, profileId, asText(selected.id, ""), item.id);
    if (payment.ok) {
      return plan(`✅ Payment reserved. Order ${asText(selected.public_reference, asText(selected.id, ""))} is sent for dispatch. Reply 4 to view your orders or MENU.`, "menu");
    }
    return plan(`Payment is still pending for ${asText(selected.public_reference, "your order")}. ${payment.message} Reply PAY to try again after resolving the issue.`, "payment.pending", { orderId: selected.id, publicReference: selected.public_reference });
  }

  if (["4", "orders", "status", "track", "tracking"].includes(normalized)) {
    const result = await db.from("lpg_refill_orders")
      .select("id, public_reference, status, payment_status, total_amount, currency_code, created_at, tracking_session_id")
      .eq("customer_user_id", profileId)
      .order("created_at", { ascending: false })
      .limit(5);
    if (result.error) throw result.error;
    const orders = arrayOfRecords(result.data);
    if (orders.length === 0) return plan("No LPG orders were found for your linked SKIMA account yet. Reply 1 to start a refill or MENU for options.", "menu");
    const lines: string[] = ["Your latest SKIMA LPG orders", ""];
    for (const order of orders) {
      lines.push(`• ${asText(order.public_reference, asText(order.id, "Order"))} — ${humanizeStatus(asText(order.status, "unknown"))} / payment ${humanizeStatus(asText(order.payment_status, "unknown"))} — ${money(numberValue(order.total_amount) ?? 0, asText(order.currency_code, "NGN"))}`);
      if (["payment_reserved", "assigned", "accepted", "en_route", "driver_arrived", "refilling", "returning", "delivery_arrived"].includes(asText(order.status, "").toLowerCase())) {
        const location = await latestDriverLocation(db, asText(order.id, ""));
        if (location) {
          lines.push(`  Latest driver location: https://www.google.com/maps?q=${location.latitude},${location.longitude} (updated ${formatDate(location.recorded_at)})`);
        }
      }
    }
    lines.push("", "For fresh status, reply 4 again. Reply 1 to start a refill or MENU for options.");
    return plan(lines.join("\n"), "menu");
  }

  if (["5", "help", "support"].includes(normalized)) {
    return plan(
      "SKIMA LPG support can help with orders, deliveries and account linking. Describe the issue in a message. Never send your password, wallet PIN, bank/card details or payment OTP. For any payment issue, quote your SKIMA order reference.",
      "menu",
    );
  }

  if (stage === "menu" || stage === "payment.pending") return plan("I didn't recognise that choice. Reply with 1, 2, 3, 4 or 5, or MENU to see all options.", "menu");
  return plan("I couldn't match that response to the current step. Reply MENU to restart the ordering flow; no payment is confirmed by this message.", "menu");
}

async function requestCanonicalQuote(args: {
  whatsappWaId: string;
  cylinderId: string;
  requestedKg: number | null;
  pickupLocationId: string;
  deliveryLocationId: string;
  stationBranchId: string;
  fulfillmentMode: string;
  idempotencyKey: string;
  providerMessageId: string;
}): Promise<Record<string, unknown>> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("WhatsApp quote route is not configured.");
  const response = await fetch(
    `${supabaseUrl.replace(/\/$/, "")}/functions/v1/api-gateway/internal/whatsapp/lpg/quote`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        whatsappWaId: args.whatsappWaId,
        cylinderId: args.cylinderId,
        requestedKg: args.requestedKg,
        pickupLocationId: args.pickupLocationId,
        deliveryLocationId: args.deliveryLocationId,
        stationBranchId: args.stationBranchId,
        fulfillmentMode: args.fulfillmentMode,
        idempotencyKey: args.idempotencyKey,
        providerMessageId: args.providerMessageId,
      }),
    },
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(body) || body.ok !== true || !isRecord(body.data)) {
    const message = isRecord(body) && typeof body.message === "string" ? body.message : "Canonical SKIMA quoting is temporarily unavailable.";
    throw new Error(message);
  }
  return body.data;
}

async function attemptReservation(
  db: SupabaseClient,
  profileId: string,
  orderId: string,
  providerMessageId: string,
): Promise<{ ok: boolean; message: string }> {
  if (!orderId) return { ok: false, message: "The order reference is missing, so no payment action was taken." };
  const result = await db.rpc("reserve_and_dispatch_lpg_refill_order", {
    target_lpg_order_id: orderId,
    target_actor_user_id: profileId,
    target_idempotency_key: await idempotencyKey("reserve", providerMessageId),
    target_customer_wallet_id: null,
    target_escrow_wallet_id: null,
    target_source: "skima.lpg.whatsapp",
    target_metadata: { channel: "whatsapp", provider_message_id: providerMessageId },
  });
  if (result.error) {
    const error = (result.error.message ?? "").toLowerCase();
    if (error.includes("no nearby driver") || error.includes("no eligible lpg driver")) {
      return { ok: false, message: "No eligible delivery driver is available right now. SKIMA's backend rejected the reservation, so your wallet was not charged. Try again shortly." };
    }
    if (error.includes("insufficient") || error.includes("balance")) {
      return { ok: false, message: "Your SKIMA wallet does not have enough available balance, or the reservation could not verify funds. Your wallet was not charged. Top up in the app, then retry." };
    }
    return { ok: false, message: "SKIMA could not reserve the payment. The order remains pending unless the app shows otherwise; check the app or retry shortly." };
  }

  // Do not tell the customer it was funded based on an RPC response alone.
  const check = await db.from("lpg_refill_orders")
    .select("id, payment_status, status")
    .eq("id", orderId)
    .eq("customer_user_id", profileId)
    .maybeSingle();
  if (check.error || !check.data || !["reserved", "paid", "settled"].includes(String(check.data.payment_status).toLowerCase())) {
    return { ok: false, message: "SKIMA accepted the request but has not confirmed the payment state yet. Check the order in the SKIMA app before trying again." };
  }
  return { ok: true, message: "" };
}

async function latestDriverLocation(
  db: SupabaseClient,
  orderId: string,
): Promise<{ latitude: number; longitude: number; recorded_at: string } | null> {
  const result = await db.from("lpg_driver_locations")
    .select("latitude, longitude, recorded_at")
    .eq("lpg_order_id", orderId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error || !result.data) return null;
  const latitude = Number(result.data.latitude);
  const longitude = Number(result.data.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude, recorded_at: String(result.data.recorded_at) };
}

function plan(text: string, stateKey = "menu", state: Record<string, unknown> = {}): ReplyPlan {
  return { text, stateKey, state };
}
function selectNumber(input: string, choices: Record<string, unknown>[]): Record<string, unknown> | null {
  const match = /^\d+$/.exec(input.trim());
  if (!match) return null;
  const index = Number(input.trim()) - 1;
  return index >= 0 && index < choices.length ? choices[index] : null;
}
function formatLocations(locations: Record<string, unknown>[]): string {
  return locations.map((location, index) =>
    `${index + 1}. ${asText(location.label, "Saved location")} — ${asText(location.address, "Address in SKIMA")}`
  ).join("\n");
}
function formatStations(stations: Record<string, unknown>[]): string {
  return stations.slice(0, 8).map((station, index) => {
    const mode = station.fulfillmentMode === "station_managed" ? "Station Managed" : "SKIMA driver";
    const price = numberValue(station.price_per_kg);
    const currency = asText(station.currency_code, "NGN");
    return `${index + 1}. ${asText(station.display_name, "Approved refill option")} — ${mode}${price === null ? "" : ` (indicative ${money(price, currency)}/kg)`}\n   ${asText(station.formatted_address, "Location available in SKIMA")}`;
  }).join("\n");
}
function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function asText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function numberValue(value: unknown): number | null {
  const result = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(result) ? result : null;
}
function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
function formatDate(value: unknown): string {
  if (typeof value !== "string") return "not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "not available" : date.toLocaleString("en-NG", { timeZone: "Africa/Lagos" });
}
function humanizeStatus(value: string): string {
  return value.replace(/[_-]+/g, " ");
}
async function idempotencyKey(prefix: string, source: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  const hash = Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `wa-${prefix}-${hash.slice(0, 32)}`;
}
function classifyError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("customer terms")) return "customer_terms_not_accepted";
  if (lower.includes("expired") || lower.includes("quote")) return "quote_step_failed";
  if (lower.includes("wallet") || lower.includes("balance")) return "payment_reservation_failed";
  return "backend_operation_failed";
}

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

function extractMessages(payload: Record<string, unknown>): InboundMessage[] {
  const result: InboundMessage[] = [];
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue;
      const messages = Array.isArray(change.value.messages) ? change.value.messages : [];
      for (const message of messages) {
        if (!isRecord(message) || typeof message.from !== "string" || typeof message.id !== "string") continue;
        const type = typeof message.type === "string" ? message.type : "unknown";
        const textBody = type === "text" && isRecord(message.text) && typeof message.text.body === "string"
          ? message.text.body : undefined;
        result.push({
          from: message.from,
          id: message.id,
          type,
          text: textBody,
          timestamp: typeof message.timestamp === "string" ? message.timestamp : undefined,
        });
      }
    }
  }
  return result;
}

function extractStatuses(payload: Record<string, unknown>): ProviderDeliveryStatus[] {
  const result: ProviderDeliveryStatus[] = [];
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue;
      const statuses = Array.isArray(change.value.statuses) ? change.value.statuses : [];
      for (const value of statuses) {
        if (!isRecord(value) || typeof value.id !== "string" || typeof value.status !== "string") continue;
        if (!["sent", "delivered", "read", "failed"].includes(value.status)) continue;
        const firstError = Array.isArray(value.errors) && isRecord(value.errors[0]) ? value.errors[0] : null;
        result.push({
          id: value.id,
          status: value.status as ProviderDeliveryStatus["status"],
          timestamp: typeof value.timestamp === "string" ? value.timestamp : undefined,
          errorCode: firstError && (typeof firstError.code === "string" || typeof firstError.code === "number")
            ? String(firstError.code)
            : undefined,
        });
      }
    }
  }
  return result;
}

async function sendWhatsAppText(args: {
  accessToken: string; graphVersion: string; phoneNumberId: string; recipient: string; text: string;
}): Promise<{ ok: boolean; error: string }> {
  const response = await fetch(
    `https://graph.facebook.com/${args.graphVersion}/${args.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${args.accessToken}`, "content-type": "application/json" },
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

async function dispatchOrderStatusNotifications(request: Request): Promise<Response> {
  const expectedSecret = Deno.env.get("SKIMA_WHATSAPP_DISPATCH_SECRET") ?? "";
  const suppliedSecret = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!expectedSecret || !timingSafeEqual(expectedSecret, suppliedSecret)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const accessToken = Deno.env.get("SKIMA_WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("SKIMA_WHATSAPP_PHONE_NUMBER_ID");
  const graphVersion = Deno.env.get("SKIMA_WHATSAPP_GRAPH_API_VERSION");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!accessToken || !phoneNumberId || !graphVersion || !supabaseUrl || !serviceRoleKey) {
    return json({ ok: false, error: "whatsapp_provider_not_configured" }, 503);
  }
  if (!/^v\d+\.\d+$/.test(graphVersion)) {
    return json({ ok: false, error: "invalid_graph_api_version_configuration" }, 500);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const claimedResult = await db.rpc("claim_skima_whatsapp_order_notifications", { target_limit: 25 });
  if (claimedResult.error) {
    console.error(JSON.stringify({ event: "whatsapp_outbox_claim_failed", code: "claim_failed" }));
    return json({ ok: false, error: "notification_queue_unavailable" }, 500);
  }

  const claimed = arrayOfRecords(claimedResult.data);
  let sent = 0;
  let queuedForRetry = 0;
  let deadLettered = 0;
  for (const item of claimed) {
    const notificationId = asText(item.notification_id, "");
    const recipient = asText(item.whatsapp_wa_id, "");
    const attempt = numberValue(item.attempt_count) ?? 1;
    const payload = asRecord(item.payload);
    if (!notificationId || !/^[0-9]{6,20}$/.test(recipient)) {
      if (notificationId) {
        await db.from("skima_whatsapp_order_notifications")
          .update({
            status: "failed",
            locked_at: null,
            last_error_code: "invalid_notification_recipient",
            updated_at: new Date().toISOString(),
          })
          .eq("id", notificationId)
          .eq("status", "processing");
      }
      deadLettered += 1;
      continue;
    }

    const templateName = Deno.env.get("SKIMA_WHATSAPP_ORDER_UPDATE_TEMPLATE") ?? "skima_lpg_order_update";
    const templateLanguage = Deno.env.get("SKIMA_WHATSAPP_ORDER_UPDATE_LANGUAGE") ?? "en";
    const result = await sendWhatsAppTemplate({
      accessToken,
      graphVersion,
      phoneNumberId,
      recipient,
      templateName,
      languageCode: templateLanguage,
      payload,
    });

    if (result.ok) {
      const saved = await db.from("skima_whatsapp_order_notifications")
        .update({
          status: "sent",
          provider_message_id: result.providerMessageId,
          provider_delivery_status: result.providerMessageId ? "sent" : null,
          provider_status_at: result.providerMessageId ? new Date().toISOString() : null,
          sent_at: new Date().toISOString(),
          locked_at: null,
          last_error_code: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", notificationId)
        .eq("status", "processing");
      if (saved.error) {
        console.error(JSON.stringify({ event: "whatsapp_outbox_sent_but_not_recorded", notificationId }));
      } else {
        sent += 1;
      }
      continue;
    }

    const retry = result.retryable && attempt < 8;
    const delayMinutes = Math.min(360, Math.max(1, 2 ** Math.min(attempt, 8)));
    const nextAttemptAt = new Date(Date.now() + delayMinutes * 60_000).toISOString();
    const saved = await db.from("skima_whatsapp_order_notifications")
      .update({
        status: retry ? "queued" : "failed",
        next_attempt_at: nextAttemptAt,
        locked_at: null,
        last_error_code: result.errorCode,
        updated_at: new Date().toISOString(),
      })
      .eq("id", notificationId)
      .eq("status", "processing");
    if (saved.error) {
      console.error(JSON.stringify({ event: "whatsapp_outbox_failure_not_recorded", notificationId }));
    }
    if (retry) queuedForRetry += 1;
    else deadLettered += 1;
  }

  return json({ ok: true, claimed: claimed.length, sent, queuedForRetry, deadLettered });
}

async function sendWhatsAppTemplate(args: {
  accessToken: string;
  graphVersion: string;
  phoneNumberId: string;
  recipient: string;
  templateName: string;
  languageCode: string;
  payload: Record<string, unknown>;
}): Promise<{ ok: true; providerMessageId: string | null } | { ok: false; errorCode: string; retryable: boolean }> {
  const amount = numberValue(args.payload.totalAmount) ?? 0;
  const currency = asText(args.payload.currencyCode, "NGN");
  const orderReference = asText(args.payload.publicReference, "LPG order");
  const orderStatus = humanizeStatus(asText(args.payload.orderStatus, "updated"));
  const paymentStatus = humanizeStatus(asText(args.payload.paymentStatus, "unknown"));
  const response = await fetch(
    `https://graph.facebook.com/${args.graphVersion}/${args.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${args.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: args.recipient,
        type: "template",
        template: {
          name: args.templateName,
          language: { code: args.languageCode },
          components: [{
            type: "body",
            parameters: [
              { type: "text", text: orderReference },
              { type: "text", text: orderStatus },
              { type: "text", text: paymentStatus },
              { type: "text", text: money(amount, currency) },
            ],
          }],
        },
      }),
    },
  ).catch(() => null);

  if (!response) return { ok: false, errorCode: "meta_network_error", retryable: true };
  let body: unknown = null;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const errorObject = isRecord(body) && isRecord(body.error) ? body.error : {};
    const code = typeof errorObject.code === "string" || typeof errorObject.code === "number"
      ? String(errorObject.code)
      : `http_${response.status}`;
    return {
      ok: false,
      errorCode: `meta_${code}`.slice(0, 180),
      retryable: response.status === 429 || response.status >= 500,
    };
  }
  const messages = isRecord(body) && Array.isArray(body.messages) ? body.messages : [];
  const firstMessage = isRecord(messages[0]) ? messages[0] : null;
  return {
    ok: true,
    providerMessageId: firstMessage && typeof firstMessage.id === "string" ? firstMessage.id : null,
  };
}

async function markEventFailed(db: SupabaseClient, id: string, error: string): Promise<void> {
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
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
