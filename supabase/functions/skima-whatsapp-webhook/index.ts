import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.9";
import { validateUtilityCustomer } from "../_shared/utility-provider-runtime.ts";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const MENU = [
  "Welcome to SKIMA 👋",
  "",
  "Choose a SKIMA service:",
  "1 — LPG refill",
  "2 — Petrol, diesel or kerosene",
  "3 — Bills (airtime, data, electricity and more)",
  "4 — Logistics booking",
  "5 — SKIMA Store",
  "6 — Fund my SKIMA wallet",
  "7 — Retry a pending LPG payment",
  "8 — Track my orders and requests",
  "9 — Help & customer support",
  "0 — Enable LPG order updates",
  "",
  "Reply MENU at any time to return here.",
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
    return await dispatchWhatsAppOutboxes(request);
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
    const supportStatusResult = await db.from("skima_whatsapp_support_outbox")
      .update({
        provider_delivery_status: status.status,
        provider_status_at: providerTime,
        provider_error_code: status.errorCode ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("provider_message_id", status.id)
      .select("id")
      .maybeSingle();
    if (supportStatusResult.error) {
      return json({ ok: false, error: "support_delivery_status_persistence_failed" }, 500);
    }
    if (supportStatusResult.data) statusesRecorded += 1;
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
    return plan("WhatsApp order-status notifications are now off. You can still message SKIMA to check your orders. Reply 0 to opt in again.", "menu");
  }
  if (normalized === "menu") return plan(MENU, "menu", {});
  if (["cancel", "restart"].includes(normalized)) {
    return plan("Cancelled the current step. No new order was created by that command.\n\n" + MENU, "menu");
  }
  const agentHelp = ["agent help", "support agent help", "support commands"].includes(normalized);
  if (agentHelp) {
    return plan([
      "SKIMA Support Agent commands:",
      "",
      "CLAIM SK-XXXXXXXX — claim an unassigned case",
      "REPLY SK-XXXXXXXX your message — send a customer-visible reply",
      "NOTE SK-XXXXXXXX your note — add a private internal note",
      "",
      "You must link this WhatsApp number to your SKIMA staff account and have support-manage permission for that app. Replies are saved in the shared Admin/app support conversation.",
    ].join("\n"), "menu");
  }

  const agentCommand = /^(REPLY|NOTE|CLAIM)\s+(SK-[A-F0-9]{8})(?:\s+([\s\S]+))?$/i.exec(input);
  if (agentCommand) {
    const command = agentCommand[1].toUpperCase();
    const reference = agentCommand[2].toUpperCase();
    const body = (agentCommand[3] ?? "").trim();
    if (command === "CLAIM") {
      const claimed = await db.rpc("skima_whatsapp_claim_support_thread", {
        target_agent_whatsapp_wa_id: whatsappWaId,
        target_support_reference: reference,
      });
      if (claimed.error) {
        return plan("I could not claim that case. Confirm that this WhatsApp number is linked to your SKIMA staff account, that you have permission for the app's support queue, and that the case is not assigned to another agent. Reply HELP for commands.", "menu");
      }
      return plan(`You have claimed support case ${reference}. You can now reply with: REPLY ${reference} your message`, "menu");
    }
    if (!body) return plan(`Add the message after the reference. Example: ${command} ${reference} I am checking this for you.`, "menu");
    const response = await db.rpc("skima_whatsapp_agent_reply_support_thread", {
      target_agent_whatsapp_wa_id: whatsappWaId,
      target_support_reference: reference,
      target_body: body,
      target_is_internal: command === "NOTE",
      target_provider_message_id: item.id,
    });
    if (response.error) {
      return plan("I could not send that response. Confirm that this WhatsApp number is linked to your SKIMA staff account, you have manage permission for this app, and the case is assigned to you. Reply HELP for commands.", "menu");
    }
    return plan(
      command === "NOTE"
        ? `Your private internal note has been recorded on ${reference}. It was not sent to the customer.`
        : `Your reply has been added to ${reference}. The customer's WhatsApp message will be sent when their service conversation is open.`,
      "menu",
    );
  }

  if (stage === "menu" && ["9", "support", "help", "customer support", "help & support"].includes(normalized)) {
    return plan([
      "Which SKIMA app do you need help with?",
      "",
      "1 — Refill (LPG and Fuel)",
      "2 — Store",
      "3 — Logistics",
      "4 — Bills",
      "",
      "Reply with the number.",
    ].join("\n"), "support.app");
  }

  if (stage === "support.app") {
    const apps = [
      { value: "refill", label: "Refill" },
      { value: "store", label: "Store" },
      { value: "logistics", label: "Logistics" },
      { value: "bills", label: "Bills" },
    ];
    const selected = selectNumber(input, apps as unknown as Record<string, unknown>[]);
    if (!selected) return plan("Reply 1 for Refill, 2 for Store, 3 for Logistics or 4 for Bills. You can reply MENU to cancel.", stage);
    const appKey = asText(selected.value, "refill");
    const appLabel = apps.find((entry) => entry.value === appKey)?.label ?? "SKIMA";
    return plan([
      `What is your ${appLabel} issue about?`,
      "",
      "1 — Payment or wallet",
      "2 — Order or service",
      "3 — Delivery or fulfilment",
      "4 — Account or sign-in",
      "5 — App issue",
      "6 — Safety concern",
      "7 — Other",
    ].join("\n"), "support.category", { supportAppKey: appKey, supportAppLabel: appLabel });
  }

  if (stage === "support.category") {
    const categories = [
      { key: "payment", label: "Payment or wallet" },
      { key: "order", label: "Order or service" },
      { key: "delivery", label: "Delivery or fulfilment" },
      { key: "account", label: "Account or sign-in" },
      { key: "technical", label: "App issue" },
      { key: "safety", label: "Safety concern" },
      { key: "other", label: "Other" },
    ];
    const selected = selectNumber(input, categories as unknown as Record<string, unknown>[]);
    if (!selected) return plan("Choose a category from 1 to 7, or reply MENU to cancel.", stage, state);
    const categoryKey = asText(selected.key, "other");
    const categoryLabel = categories.find((entry) => entry.key === categoryKey)?.label ?? "Other";
    return plan(
      `Please describe the ${categoryLabel.toLowerCase()} issue in one message. Include an order or transaction reference where available. Do not include your password, wallet PIN, OTP or card details.`,
      "support.message",
      { ...state, supportCategory: categoryKey, supportCategoryLabel: categoryLabel },
    );
  }

  if (stage === "support.message") {
    if (input.length > 4000) return plan("Please keep the support message under 4,000 characters.", stage, state);
    const firstLine = input.split(/\r?\n/)[0]?.trim() ?? "";
    const subject = firstLine.length >= 3 ? firstLine.slice(0, 160) : "Customer support request";
    const created = await db.rpc("skima_whatsapp_create_support_thread", {
      target_whatsapp_wa_id: whatsappWaId,
      target_app_key: asText(state.supportAppKey, "refill"),
      target_category: asText(state.supportCategory, "other"),
      target_subject: subject,
      target_body: input,
      target_provider_message_id: item.id,
    });
    if (created.error) {
      return plan("I could not open your support request right now. Please try again, or use Help & Support inside the SKIMA app.", "menu");
    }
    const record = asRecord(created.data);
    const reference = asText(record.reference, "");
    const appLabel = asText(state.supportAppLabel, "SKIMA");
    if (!reference) return plan("Your support request was received, but I could not retrieve its reference. Please contact SKIMA Support in the app.", "menu");
    return plan([
      `Your ${appLabel} support request has been sent.`,
      `Reference: ${reference}`,
      "",
      "A support agent can now take over this conversation. You can keep sending details here and they will be added to the same case.",
      "",
      "Reply MENU to return to SKIMA services.",
    ].join("\n"), "support.active", {
      supportAppKey: asText(state.supportAppKey, "refill"),
      supportAppLabel: appLabel,
      supportReference: reference,
    });
  }

  if (stage === "support.active") {
    const reference = asText(state.supportReference, "");
    if (!reference) return plan("Your support reference is no longer available. Reply 9 from the main menu to open a new support request.", "menu");
    if (input.length > 4000) return plan("Please keep your support reply under 4,000 characters.", stage, state);
    const saved = await db.rpc("skima_whatsapp_reply_support_thread", {
      target_whatsapp_wa_id: whatsappWaId,
      target_support_reference: reference,
      target_body: input,
      target_provider_message_id: item.id,
    });
    if (saved.error) return plan("I could not add that message to your support case. Reply MENU and choose Help & Support to start again, or use the support conversation in the SKIMA app.", "menu");
    return plan(`Your message has been added to support case ${reference}. A support agent can see the updated conversation.`, "support.active", state);
  }


  // Fuel ordering follows the live Fuel product, station-offer, container,
  // commercial quote and wallet reservation engines.
  if (stage === "menu" && ["2", "fuel", "petrol", "diesel", "kerosene"].includes(normalized)) {
    const [productsResult, offersResult, containersResult, choicesResult, wallets] = await Promise.all([
      db.from("fuel_products").select("id,key,display_name,quantity_precision,status").eq("status", "enabled").order("key"),
      db.from("fuel_branch_product_offers").select("id,branch_id,product_key,currency_code,price_per_litre,admin_override_price_per_litre,minimum_litres,maximum_litres,fulfillment_modes,status,effective_from,effective_until,branch:organization_branches(id,display_name,address)").eq("status", "active").order("updated_at", { ascending: false }).limit(50),
      db.from("fuel_container_types").select("id,key,display_name,nominal_capacity_litres,supported_product_keys,status").eq("status", "active").order("nominal_capacity_litres"),
      db.rpc("read_skima_whatsapp_customer_choices", { target_whatsapp_wa_id: whatsappWaId }),
      readWhatsAppCustomerWallets(db, profileId),
    ]);
    if (productsResult.error) throw productsResult.error;
    if (offersResult.error) throw offersResult.error;
    if (containersResult.error) throw containersResult.error;
    if (choicesResult.error) throw choicesResult.error;
    const locations = arrayOfRecords(asRecord(choicesResult.data).locations);
    const products = arrayOfRecords(productsResult.data).filter((product) =>
      ["fuel.pms", "fuel.ago", "fuel.dpk"].includes(asText(product.key, ""))
    );
    const offers = arrayOfRecords(offersResult.data).filter((offer) =>
      isCurrentlyEffective(offer.effective_from, offer.effective_until) &&
      Array.isArray(offer.fulfillment_modes) && offer.fulfillment_modes.length > 0
    );
    const containers = arrayOfRecords(containersResult.data);
    if (!wallets.length) return plan("To order Fuel, first create or fund your customer wallet in the SKIMA app. Then return here and reply 2.", "menu");
    if (!locations.length) return plan("Add an active saved delivery address in your SKIMA account before ordering Fuel. Then reply MENU.", "menu");
    const availableProducts = products.filter((product) => offers.some((offer) =>
      asText(offer.product_key, "") === asText(product.key, "") &&
      wallets.some((wallet) => asText(wallet.currencyCode, "") === asText(offer.currency_code, ""))
    ));
    if (!availableProducts.length) {
      return plan("There is no enabled Fuel station offer in the currency of your active SKIMA wallet right now. Please check again later or contact support.", "menu");
    }
    return plan(
      "Which product would you like?\n\n" + availableProducts.map((product, index) =>
        (index + 1) + " — " + asText(product.display_name, asText(product.key, "Fuel"))
      ).join("\n") + "\n\nPMS is petrol, AGO is diesel and DPK is kerosene. Reply with a number.",
      "fuel.product",
      { products: availableProducts, offers, containers, locations, wallets },
    );
  }

  if (stage === "fuel.product") {
    const products = arrayOfRecords(state.products);
    const selected = selectNumber(input, products);
    if (!selected) return plan("Choose a listed Fuel product by number, or reply MENU to cancel.", stage, state);
    const productKey = asText(selected.key, "");
    const wallets = arrayOfRecords(state.wallets);
    const offers = arrayOfRecords(state.offers).filter((offer) =>
      asText(offer.product_key, "") === productKey &&
      wallets.some((wallet) => asText(wallet.currencyCode, "") === asText(offer.currency_code, ""))
    );
    const options = offers.map((offer) => {
      const branch = asRecord(offer.branch);
      const wallet = walletForCurrency(wallets, asText(offer.currency_code, ""));
      return { ...offer, _branchName: asText(branch.display_name, "Fuel station"), _wallet: wallet };
    }).filter((offer) => Boolean(offer._wallet)).slice(0, 8);
    if (!options.length) return plan("There is no active station offer for that product in your wallet currency. Choose another product or reply MENU.", "menu");
    return plan(
      "Choose a station and fulfilment option:\n\n" + formatFuelOfferChoices(options) + "\n\nReply with the number.",
      "fuel.station",
      { ...state, product: selected, stationOptions: options },
    );
  }

  if (stage === "fuel.station") {
    const options = arrayOfRecords(state.stationOptions);
    const selected = selectNumber(input, options);
    if (!selected) return plan("Choose one of the listed Fuel station offers, or reply MENU to cancel.", stage, state);
    const modes = Array.isArray(selected.fulfillment_modes)
      ? selected.fulfillment_modes.filter((value): value is string => typeof value === "string")
      : [];
    const modeOptions = modes.map((value) => ({
      key: value,
      label: value === "station_managed" ? "Station managed" :
        value === "independent_driver" ? "Independent driver" :
        value === "skima_managed" ? "SKIMA managed delivery" : value,
    }));
    if (!modeOptions.length) return plan("That station no longer has an available fulfilment mode. Reply MENU and choose another offer.", "menu");
    return plan(
      "How should this Fuel order be fulfilled?\n\n" + modeOptions.map((value, index) => (index + 1) + " — " + value.label).join("\n") + "\n\nReply with a number.",
      "fuel.fulfillment",
      { ...state, selectedOffer: selected, modeOptions },
    );
  }

  if (stage === "fuel.fulfillment") {
    const modes = arrayOfRecords(state.modeOptions);
    const selected = selectNumber(input, modes);
    if (!selected) return plan("Choose one of the listed fulfilment modes by number.", stage, state);
    const offer = asRecord(state.selectedOffer);
    const min = numberValue(offer.minimum_litres) ?? 1;
    const max = numberValue(offer.maximum_litres);
    return plan(
      "How many litres do you need? The selected station accepts " + min + " to " + (max ?? "its configured maximum") + " litres. Reply with a number.",
      "fuel.amount",
      { ...state, fulfillmentMode: selected.key },
    );
  }

  if (stage === "fuel.amount") {
    const litres = Number(input.replace(/\s*(litres?|l)$/i, "").trim());
    const offer = asRecord(state.selectedOffer);
    const min = numberValue(offer.minimum_litres) ?? 1;
    const max = numberValue(offer.maximum_litres);
    if (!Number.isFinite(litres) || litres < min || (max !== null && litres > max)) {
      return plan("Enter a valid litre quantity between " + min + " and " + (max ?? "the station maximum") + ".", stage, state);
    }
    return plan(
      "Choose your container option:\n\n1 — Purchase a container\n2 — Rent a container",
      "fuel.container-mode",
      { ...state, requestedLitres: litres },
    );
  }

  if (stage === "fuel.container-mode") {
    const modes = [
      { key: "purchase", label: "Purchase" },
      { key: "rental", label: "Rental" },
    ];
    const selected = selectNumber(input, modes as unknown as Record<string, unknown>[]);
    if (!selected) return plan("Reply 1 to purchase a container or 2 to rent one.", stage, state);
    const product = asRecord(state.product);
    const productKey = asText(product.key, "");
    const containers = arrayOfRecords(state.containers).filter((container) =>
      Array.isArray(container.supported_product_keys) && container.supported_product_keys.includes(productKey)
    ).slice(0, 8);
    if (!containers.length) return plan("There is no active container type configured for this Fuel product. Please contact SKIMA support.", "menu");
    return plan(
      "Choose a container type:\n\n" + containers.map((container, index) =>
        (index + 1) + " — " + asText(container.display_name, "Container") +
        (numberValue(container.nominal_capacity_litres) === null ? "" : " (" + numberValue(container.nominal_capacity_litres) + " L)")
      ).join("\n") + "\n\nReply with the number.",
      "fuel.container-type",
      { ...state, containerMode: selected.key, containerOptions: containers },
    );
  }

  if (stage === "fuel.container-type") {
    const containers = arrayOfRecords(state.containerOptions);
    const selected = selectNumber(input, containers);
    if (!selected) return plan("Choose a container type from the list, or reply MENU to cancel.", stage, state);
    const locations = arrayOfRecords(state.locations);
    return plan("Choose the saved delivery address for this Fuel order:\n\n" + formatLocations(locations), "fuel.location", {
      ...state,
      containerType: selected,
    });
  }

  if (stage === "fuel.location") {
    const locations = arrayOfRecords(state.locations);
    const selected = selectNumber(input, locations);
    if (!selected) return plan("Choose one of your saved delivery addresses by number.", stage, state);
    const product = asRecord(state.product);
    const offer = asRecord(state.selectedOffer);
    const container = asRecord(state.containerType);
    const created = await db.rpc("skima_whatsapp_create_fuel_order", {
      target_whatsapp_wa_id: whatsappWaId,
      target_branch_id: asText(offer.branch_id, ""),
      target_product_key: asText(product.key, ""),
      target_requested_litres: numberValue(state.requestedLitres),
      target_container_mode: asText(state.containerMode, ""),
      target_container_type_key: asText(container.key, ""),
      target_fulfillment_mode: asText(state.fulfillmentMode, ""),
      target_currency_code: asText(offer.currency_code, "NGN"),
      target_delivery_location_id: asText(selected.id, ""),
      target_delivery_instructions: null,
      target_idempotency_key: await idempotencyKey("fuel-order", item.id),
    });
    if (created.error) return plan("SKIMA could not create this Fuel order: " + safeCustomerError(created.error.message) + ". No wallet payment was taken. Reply MENU to restart.", "menu");
    const quote = asRecord(created.data);
    const orderId = asText(quote.order_id, "");
    const quoteId = asText(quote.price_quote_id, "");
    const total = numberValue(quote.total_amount);
    if (!orderId || !quoteId || total === null) throw new Error("Fuel quote response is missing its order, quote or total.");
    const branch = asRecord(offer.branch);
    const productName = asText(product.display_name, asText(product.key, "Fuel"));
    const currency = asText(quote.currency_code, asText(offer.currency_code, "NGN"));
    return plan([
      "Your Fuel quote is ready — review it before payment.",
      "",
      "Product: " + productName,
      "Station: " + asText(branch.display_name, asText(offer._branchName, "Selected station")),
      "Quantity: " + state.requestedLitres + " litres",
      "Container: " + asText(container.display_name, "Container") + " (" + asText(state.containerMode, "rental") + ")",
      "Fulfilment: " + asText(state.fulfillmentMode, "not specified").replace(/_/g, " "),
      "Subtotal: " + money(numberValue(quote.subtotal_amount) ?? 0, currency),
      "Fees: " + money(numberValue(quote.fee_amount) ?? 0, currency),
      "Tax: " + money(numberValue(quote.tax_amount) ?? 0, currency),
      "TOTAL: " + money(total, currency),
      "Quote expires: " + formatDate(quote.expires_at),
      "",
      "Reply CONFIRM to accept this quote and reserve payment from your SKIMA Wallet. No payment has been taken yet.",
    ].join("\n"), "fuel.confirm", {
      orderId,
      quoteId,
      totalAmount: total,
      currencyCode: currency,
      wallet: asRecord(offer._wallet),
      productName,
    });
  }

  if (stage === "fuel.confirm") {
    if (!["confirm", "yes", "pay", "confirm and pay"].includes(normalized)) {
      return plan("Reply CONFIRM to accept the Fuel quote and reserve wallet payment, or MENU to stop.", stage, state);
    }
    const result = await db.rpc("skima_whatsapp_pay_fuel_order", {
      target_whatsapp_wa_id: whatsappWaId,
      target_order_id: asText(state.orderId, ""),
      target_price_quote_id: asText(state.quoteId, ""),
      target_wallet_id: asText(asRecord(state.wallet).id, ""),
      target_idempotency_key: await idempotencyKey("fuel-pay", asText(state.orderId, item.id)),
    });
    if (result.error) {
      return plan("Fuel payment was not confirmed: " + safeCustomerError(result.error.message) + ". Top up your SKIMA Wallet if needed, then reply CONFIRM to retry this same quote.", stage, state);
    }
    const payment = asRecord(result.data);
    if (asText(payment.status, "") !== "payment_reserved") {
      return plan("SKIMA has not confirmed the Fuel wallet reservation yet. Please check your app before trying again.", stage, state);
    }
    return plan(
      "✅ Fuel payment reserved successfully.\nOrder: " + asText(state.orderId, "") +
      "\nAmount reserved: " + money(numberValue(payment.totalAmount) ?? numberValue(state.totalAmount) ?? 0, asText(payment.currencyCode, "NGN")) +
      "\nYour station and fulfilment team will process the order. Reply 8 to track it or MENU for other services.",
      "menu",
      {},
    );
  }

  // Bills are read from the live utility catalogue and validated through the
  // configured provider adapter before the canonical utility request reserves funds.
  if (stage === "menu" && ["3", "bills", "bill payment", "airtime", "data", "electricity"].includes(normalized)) {
    const catalogResult = await db.rpc("read_utility_catalog");
    if (catalogResult.error) throw catalogResult.error;
    const products = arrayOfRecords(catalogResult.data).filter((product) =>
      product.available === true && asText(product.amount_mode, "") !== "provider"
    );
    if (!products.length) return plan("SKIMA Bills is not offering a currently available bill service. Please try again later.", "menu");
    return plan(
      "Choose a bill service:\n\n" + products.slice(0, 10).map((product, index) =>
        (index + 1) + " — " + asText(product.category_name, "Bills") + " / " +
        asText(product.biller_name, "Provider") + " / " + asText(product.product_name, "Service")
      ).join("\n") + "\n\nReply with the number.",
      "bills.product",
      { products },
    );
  }

  if (stage === "bills.product") {
    const products = arrayOfRecords(state.products);
    const selected = selectNumber(input, products.slice(0, 10));
    if (!selected) return plan("Choose one of the listed bill services by number.", stage, state);
    const fixed = asText(selected.amount_mode, "") === "fixed";
    const fixedAmount = numberValue(selected.fixed_amount);
    if (fixed && fixedAmount === null) return plan("This bill service has no configured fixed amount and cannot be paid yet. Choose another service.", "menu");
    return plan(
      "Enter the customer number or account reference for " + asText(selected.biller_name, "this provider") +
      ". " + asText(selected.customer_identifier_label, "Customer number") + " is required. Do not send your PIN or OTP.",
      "bills.identifier",
      { ...state, product: selected, fixedAmount },
    );
  }

  if (stage === "bills.identifier") {
    if (input.length < 3 || input.length > 100) return plan("Enter a valid customer number or account reference.", stage, state);
    const product = asRecord(state.product);
    const validationContextResult = await db.rpc("read_utility_customer_validation_context", {
      target_product_id: asText(product.product_id, ""),
    });
    if (validationContextResult.error) return plan("SKIMA could not prepare the provider validation. No payment was taken. Please try again later.", "menu");
    const validationContext = asRecord(validationContextResult.data);
    const categoryKey = asText(validationContext.categoryKey, asText(product.category_key, ""));
    if (!["airtime", "data"].includes(categoryKey)) {
      const providerKey = asText(validationContext.providerKey, "");
      const billerCode = asText(validationContext.providerBillerCode, "");
      const itemCode = asText(validationContext.providerProductCode, "");
      if (!providerKey || !billerCode || !itemCode) return plan("This bill provider is not configured for customer validation yet. No payment was taken.", "menu");
      try {
        await validateUtilityCustomer(db, {
          providerKey,
          billerCode,
          itemCode,
          customerIdentifier: input,
        });
      } catch (error) {
        return plan("The provider could not validate that customer number. Check it and reply again. No payment was taken.", stage, state);
      }
    }
    const productAmountMode = asText(product.amount_mode, "customer");
    if (productAmountMode === "fixed") {
      const fixedAmount = numberValue(product.fixed_amount);
      if (fixedAmount === null) return plan("The fixed amount for this service is not configured.", "menu");
      return plan(
        "Please review your bill payment:\n" +
        "Service: " + asText(product.product_name, "Bill service") +
        "\nProvider: " + asText(product.biller_name, "Provider") +
        "\nCustomer reference: " + maskCustomerIdentifier(input) +
        "\nAmount: " + money(fixedAmount, asText(product.currency_code, "NGN")) +
        "\n\nReply CONFIRM to reserve payment from your SKIMA Wallet. The provider purchase will then be processed.",
        "bills.confirm",
        { ...state, customerIdentifier: input, amount: fixedAmount },
      );
    }
    return plan(
      "Customer number validated. Enter the amount you want to pay in " + asText(product.currency_code, "NGN") + ".",
      "bills.amount",
      { ...state, customerIdentifier: input },
    );
  }

  if (stage === "bills.amount") {
    const amount = Number(input.replace(/,/g, "").replace(/₦/g, "").trim());
    const product = asRecord(state.product);
    const minimum = numberValue(product.minimum_amount);
    const maximum = numberValue(product.maximum_amount);
    if (!Number.isFinite(amount) || amount <= 0 || (minimum !== null && amount < minimum) || (maximum !== null && amount > maximum)) {
      return plan("Enter a valid amount" + (minimum === null ? "" : " not below " + money(minimum, asText(product.currency_code, "NGN"))) +
        (maximum === null ? "" : " and not above " + money(maximum, asText(product.currency_code, "NGN"))) + ".", stage, state);
    }
    return plan(
      "Please review your bill payment:\n" +
      "Service: " + asText(product.product_name, "Bill service") +
      "\nProvider: " + asText(product.biller_name, "Provider") +
      "\nCustomer reference: " + maskCustomerIdentifier(asText(state.customerIdentifier, "")) +
      "\nAmount: " + money(amount, asText(product.currency_code, "NGN")) +
      "\n\nReply CONFIRM to reserve payment from your SKIMA Wallet. The provider purchase will then be processed.",
      "bills.confirm",
      { ...state, amount },
    );
  }

  if (stage === "bills.confirm") {
    if (!["confirm", "yes", "pay", "confirm payment"].includes(normalized)) {
      return plan("Reply CONFIRM to reserve this bill payment, or MENU to cancel. No payment is taken before confirmation.", stage, state);
    }
    const product = asRecord(state.product);
    const wallets = await readWhatsAppCustomerWallets(db, profileId);
    const wallet = walletForCurrency(wallets, asText(product.currency_code, ""));
    if (!wallet) return plan("An active customer wallet in " + asText(product.currency_code, "the bill currency") + " is required. Fund your wallet in the SKIMA app, then reply CONFIRM again.", stage, state);
    const paid = await db.rpc("skima_whatsapp_create_utility_payment", {
      target_whatsapp_wa_id: whatsappWaId,
      target_product_id: asText(product.product_id, ""),
      target_wallet_id: asText(wallet.id, ""),
      target_customer_identifier: asText(state.customerIdentifier, ""),
      target_amount: numberValue(state.amount),
      target_recipient_phone: null,
      target_idempotency_key: await idempotencyKey("utility-payment", asText(item.id, "")),
    });
    if (paid.error) return plan("SKIMA could not reserve this bill payment: " + safeCustomerError(paid.error.message) + ". No bill purchase is confirmed. Top up if needed and start again from MENU.", "menu");
    const bill = asRecord(paid.data);
    return plan(
      "✅ Your bill payment has been reserved.\nReference: " + asText(bill.publicReference, asText(bill.requestId, "")) +
      "\nAmount: " + money(numberValue(bill.totalAmount) ?? numberValue(state.amount) ?? 0, asText(bill.currencyCode, asText(product.currency_code, "NGN"))) +
      "\nStatus: " + humanizeStatus(asText(bill.status, "payment reserved")) +
      "\nThe configured provider will process the service. This message confirms wallet reservation, not provider completion. Reply 8 to check status.",
      "menu",
      {},
    );
  }

  // Logistics uses the canonical category/geography/job/offer/booking model.
  // A job is not described as booked until a provider offer is selected and escrow is funded.
  if (stage === "menu" && ["4", "logistics", "delivery", "transport", "haulage"].includes(normalized)) {
    const [categoriesResult, choicesResult, wallets] = await Promise.all([
      db.from("logistics_service_categories").select("id,key,display_name,description,status,sort_order").eq("status", "active").order("sort_order"),
      db.rpc("read_skima_whatsapp_customer_choices", { target_whatsapp_wa_id: whatsappWaId }),
      readWhatsAppCustomerWallets(db, profileId),
    ]);
    if (categoriesResult.error) throw categoriesResult.error;
    if (choicesResult.error) throw choicesResult.error;
    const categories = arrayOfRecords(categoriesResult.data);
    if (!categories.length) return plan("SKIMA Logistics has no active customer service categories at the moment.", "menu");
    return plan(
      "What do you need moved?\n\n" + categories.slice(0, 8).map((category, index) =>
        (index + 1) + " — " + asText(category.display_name, asText(category.key, "Logistics service"))
      ).join("\n") + "\n\nReply with the number.",
      "logistics.category",
      { categories, locations: arrayOfRecords(asRecord(choicesResult.data).locations), wallets },
    );
  }

  if (stage === "logistics.category") {
    const categories = arrayOfRecords(state.categories);
    const selected = selectNumber(input, categories.slice(0, 8));
    if (!selected) return plan("Choose a logistics service category by number.", stage, state);
    return plan("Enter the pickup town, LGA or area in Nigeria. I will look it up in SKIMA's active location catalogue.", "logistics.pickup.search", { ...state, category: selected });
  }

  if (stage === "logistics.pickup.search" || stage === "logistics.destination.search") {
    const found = await db.rpc("search_logistics_geographies", {
      target_search: input,
      target_country_code: "NG",
      target_parent_id: null,
      target_limit: 8,
    });
    if (found.error) return plan("I could not search SKIMA's location catalogue. Try a shorter town or LGA name.", stage, state);
    const candidates = arrayOfRecords(found.data);
    if (!candidates.length) return plan("No active SKIMA location matched that name. Try a nearby town or LGA, using at least two characters.", stage, state);
    const nextStage = stage === "logistics.pickup.search" ? "logistics.pickup.select" : "logistics.destination.select";
    return plan(
      "Choose the correct location:\n\n" + candidates.map((place, index) =>
        (index + 1) + " — " + asText(place.canonical_name, "Area") +
        (asText(place.hierarchy_path, "") ? " (" + asText(place.hierarchy_path, "") + ")" : "")
      ).join("\n") + "\n\nReply with the number.",
      nextStage,
      { ...state, geographyOptions: candidates },
    );
  }

  if (stage === "logistics.pickup.select" || stage === "logistics.destination.select") {
    const candidates = arrayOfRecords(state.geographyOptions);
    const selected = selectNumber(input, candidates);
    if (!selected) return plan("Choose one of the listed locations by number.", stage, state);
    const place = {
      geography_id: selected.id,
      display_name: selected.canonical_name,
      address_snapshot: {
        formatted_address: selected.canonical_name,
        geography_name: selected.canonical_name,
        geography_hierarchy_path: selected.hierarchy_path,
        source: "geography_catalogue",
      },
    };
    if (stage === "logistics.pickup.select") {
      return plan("Now enter the full pickup street address, area, landmark or building details. This helps the provider find the correct pickup point.", "logistics.pickup.address", { ...state, pickupGeography: place });
    }
    return plan("Now enter the full destination street address, area, landmark or building details.", "logistics.destination.address", { ...state, destinationGeography: place });
  }

  if (stage === "logistics.pickup.address") {
    if (input.length < 5 || input.length > 500) return plan("Enter a more complete pickup address, including an area or landmark.", stage, state);
    const geography = asRecord(state.pickupGeography);
    const pickup = {
      geography_id: geography.geography_id,
      display_name: input,
      address_snapshot: {
        formatted_address: input,
        geography_name: geography.display_name,
        geography_hierarchy_path: asRecord(geography.address_snapshot).geography_hierarchy_path,
        source: "whatsapp_customer_address",
      },
    };
    return plan("Enter the destination town, LGA or area in Nigeria.", "logistics.destination.search", { ...state, pickup });
  }

  if (stage === "logistics.destination.address") {
    if (input.length < 5 || input.length > 500) return plan("Enter a more complete destination address, including an area or landmark.", stage, state);
    const geography = asRecord(state.destinationGeography);
    const destination = {
      geography_id: geography.geography_id,
      display_name: input,
      address_snapshot: {
        formatted_address: input,
        geography_name: geography.display_name,
        geography_hierarchy_path: asRecord(geography.address_snapshot).geography_hierarchy_path,
        source: "whatsapp_customer_address",
      },
    };
    return plan("What are you moving? Enter a short title, for example: Deliver a sofa and two chairs.", "logistics.title", { ...state, destination });
  }

  if (stage === "logistics.title") {
    if (input.length < 3 || input.length > 180) return plan("Enter a short description between 3 and 180 characters.", stage, state);
    return plan("Add any extra details about the item or job, or reply SKIP.", "logistics.description", { ...state, title: input });
  }

  if (stage === "logistics.description") {
    const description = ["skip", "none", "no"].includes(normalized) ? "" : input;
    return plan(
      "What type of cargo are you moving?\n\n1 — General goods\n2 — Documents\n3 — Fragile items\n4 — Furniture\n5 — Perishable goods\n6 — Not specified",
      "logistics.cargo.type",
      { ...state, description },
    );
  }

  if (stage === "logistics.cargo.type") {
    const cargoTypes = [
      { key: "general", label: "General goods" },
      { key: "documents", label: "Documents" },
      { key: "fragile", label: "Fragile items" },
      { key: "furniture", label: "Furniture" },
      { key: "perishable", label: "Perishable goods" },
      { key: "", label: "Not specified" },
    ];
    const selected = selectNumber(input, cargoTypes as unknown as Record<string, unknown>[]);
    if (!selected) return plan("Choose a cargo type from 1 to 6.", stage, state);
    return plan("What is the estimated cargo weight in kilograms? Enter a number, or reply SKIP if you do not know.", "logistics.cargo.weight", { ...state, cargoType: selected.key });
  }

  if (stage === "logistics.cargo.weight") {
    const weight = ["skip", "none", "unknown"].includes(normalized) ? null : Number(input.replace(/\s*kg$/i, "").trim());
    if (weight !== null && (!Number.isFinite(weight) || weight <= 0)) return plan("Enter a positive weight in kilograms or reply SKIP.", stage, state);
    return plan("What name should the logistics provider contact?", "logistics.contact.name", { ...state, cargoWeight: weight });
  }

  if (stage === "logistics.contact.name") {
    if (input.length < 2 || input.length > 120) return plan("Enter a valid contact name.", stage, state);
    return plan("Enter a phone number the logistics provider can reach, including country code where possible.", "logistics.contact.phone", { ...state, contactName: input });
  }

  if (stage === "logistics.contact.phone") {
    if (!/^\+?[0-9][0-9 ()-]{6,22}$/.test(input)) return plan("Enter a valid phone number, for example +234 800 000 0000.", stage, state);
    return plan("Add any handling, access or pickup instructions for the provider, or reply SKIP.", "logistics.instructions", { ...state, contactPhone: input });
  }

  if (stage === "logistics.instructions") {
    const instructions = ["skip", "none", "no"].includes(normalized) ? null : input.slice(0, 1000);
    const category = asRecord(state.category);
    const cargoType = asText(state.cargoType, "");
    const cargoWeight = numberValue(state.cargoWeight);
    const cargo: Record<string, unknown> = { cargo_type_keys: cargoType ? [cargoType] : [] };
    if (cargoWeight !== null) cargo.weight_kg = cargoWeight;
    const payload = {
      category_key: asText(category.key, ""),
      service_key: asText(category.key, ""),
      title: asText(state.title, ""),
      description: asText(state.description, "") || null,
      pickup: asRecord(state.pickup),
      destination: asRecord(state.destination),
      cargo,
      customer_contact: { name: asText(state.contactName, ""), phone: asText(state.contactPhone, "") },
      instructions,
      metadata: { channel: "whatsapp", customer_app: "logistics" },
    };
    const created = await db.rpc("skima_whatsapp_create_logistics_job", {
      target_whatsapp_wa_id: whatsappWaId,
      target_payload: payload,
      target_idempotency_key: await idempotencyKey("logistics-job", item.id),
    });
    if (created.error) return plan("SKIMA could not publish this Logistics request: " + safeCustomerError(created.error.message) + ". No booking or payment was created. Reply MENU to try again.", "menu");
    const jobId = asText(created.data, "");
    return plan(
      "✅ Your Logistics request has been published to eligible providers.\nRequest: " + jobId +
      "\nPickup: " + asText(asRecord(state.pickup).display_name, "Selected pickup") +
      "\nDestination: " + asText(asRecord(state.destination).display_name, "Selected destination") +
      "\n\nProviders can now send offers. Reply CHECK to look for offers later. A request is not a booking until you select an offer and confirm payment.",
      "logistics.offers.wait",
      { jobId, wallets: state.wallets },
    );
  }

  if (stage === "logistics.offers.wait" && ["check", "offers", "status", "refresh"].includes(normalized)) {
    const offers = await readWhatsAppLogisticsOffers(db, profileId, asText(state.jobId, ""));
    if (!offers.length) return plan("There are no active provider offers for this Logistics request yet. Providers may still be preparing a response. Reply CHECK again later or MENU.", stage, state);
    return plan("Available provider offers:\n\n" + formatLogisticsOfferChoices(offers) + "\n\nReply with the number of the offer you want to book.", "logistics.offer.select", { ...state, offers });
  }

  if (stage === "logistics.offer.select") {
    const offers = arrayOfRecords(state.offers);
    const selected = selectNumber(input, offers);
    if (!selected) return plan("Choose one of the listed Logistics offers by number, or reply CHECK to refresh.", stage, state);
    const booking = await db.rpc("skima_whatsapp_create_logistics_booking", {
      target_whatsapp_wa_id: whatsappWaId,
      target_offer_id: asText(selected.id, ""),
      target_idempotency_key: await idempotencyKey("logistics-booking", asText(selected.id, item.id)),
    });
    if (booking.error) return plan("That provider offer could not be booked: " + safeCustomerError(booking.error.message) + ". Reply CHECK to refresh the available offers.", "logistics.offers.wait", { jobId: state.jobId, wallets: state.wallets });
    const details = asRecord(booking.data);
    return plan(
      "Provider offer selected. Review the final booking amount:\nProvider: " + asText(selected.providerName, "Selected provider") +
      "\nDelivery: " + money(numberValue(details.deliveryAmount) ?? 0, asText(details.currencyCode, "NGN")) +
      "\nSKIMA booking fee: " + money(numberValue(details.customerBookingFeeAmount) ?? 0, asText(details.currencyCode, "NGN")) +
      "\nTOTAL: " + money(numberValue(details.totalCustomerCharge) ?? 0, asText(details.currencyCode, "NGN")) +
      "\n\nReply CONFIRM to reserve this amount from your SKIMA Wallet. The booking is not funded yet.",
      "logistics.booking.confirm",
      { ...state, bookingId: details.bookingId, currencyCode: details.currencyCode, totalAmount: details.totalCustomerCharge },
    );
  }

  if (stage === "logistics.booking.confirm") {
    if (!["confirm", "yes", "pay", "confirm booking"].includes(normalized)) {
      return plan("Reply CONFIRM to reserve payment for this Logistics booking. No payment has been taken yet.", stage, state);
    }
    const wallets = await readWhatsAppCustomerWallets(db, profileId);
    const wallet = walletForCurrency(wallets, asText(state.currencyCode, ""));
    if (!wallet) return plan("An active customer wallet in " + asText(state.currencyCode, "the booking currency") + " is required. Fund your wallet in the SKIMA app, then reply CONFIRM again.", stage, state);
    const payment = await db.rpc("skima_whatsapp_pay_logistics_booking", {
      target_whatsapp_wa_id: whatsappWaId,
      target_booking_id: asText(state.bookingId, ""),
      target_wallet_id: asText(wallet.id, ""),
      target_idempotency_key: await idempotencyKey("logistics-payment", asText(state.bookingId, item.id)),
    });
    if (payment.error) return plan("The Logistics booking remains unpaid: " + safeCustomerError(payment.error.message) + ". Top up if needed and reply CONFIRM to retry.", stage, state);
    const result = asRecord(payment.data);
    if (asText(result.status, "") !== "payment_reserved") return plan("SKIMA has not confirmed the Logistics escrow reservation. Check the SKIMA app before trying again.", stage, state);
    return plan("✅ Logistics booking funded. Amount reserved: " + money(numberValue(result.totalAmount) ?? numberValue(state.totalAmount) ?? 0, asText(result.currencyCode, "NGN")) + ". Your provider can now accept and fulfil the booking. Reply 8 to track it or MENU.", "menu", {});
  }

  // Store catalogue and checkout read the same active SKIMA Store catalogue,
  // effective prices, stock/availability rules and saved fulfilment locations.
  if (stage === "menu" && ["5", "store", "shop", "buy"].includes(normalized)) {
    const [catalog, choices, wallets] = await Promise.all([
      readWhatsAppStoreCatalogue(db),
      db.rpc("read_skima_whatsapp_customer_choices", { target_whatsapp_wa_id: whatsappWaId }),
      readWhatsAppCustomerWallets(db, profileId),
    ]);
    if (choices.error) throw choices.error;
    const locations = arrayOfRecords(asRecord(choices.data).locations);
    if (!catalog.products.length) return plan("SKIMA Store has no purchasable products available right now. Please check again later.", "menu");
    if (!walletForCurrency(wallets, catalog.currencyCode)) return plan("An active " + catalog.currencyCode + " customer wallet is required for SKIMA Store checkout. Create or fund your wallet in the SKIMA app, then reply MENU.", "menu");
    return plan(
      "Browse available SKIMA Store products:\n\n" + formatStoreProductChoices(catalog.products) + "\n\nReply with the number of the product you want.",
      "store.product",
      { products: catalog.products, settings: catalog.settings, locations, wallets, cart: [] },
    );
  }

  if (stage === "store.product") {
    const products = arrayOfRecords(state.products);
    const selected = selectNumber(input, products.slice(0, 10));
    if (!selected) return plan("Choose a Store product by number, or reply MENU to cancel.", stage, state);
    return plan(
      "How many units of " + asText(selected.name, "this product") + " would you like? " +
      (numberValue(selected.stock) === null ? "" : "Available stock: " + numberValue(selected.stock) + ". ") +
      "Reply with a whole number.",
      "store.quantity",
      { ...state, selectedProduct: selected },
    );
  }

  if (stage === "store.quantity") {
    const quantity = Number(input.trim());
    const product = asRecord(state.selectedProduct);
    const stock = numberValue(product.stock);
    const minQuantity = numberValue(product.minQuantity) ?? 1;
    const maxQuantity = numberValue(product.maxQuantity);
    if (!Number.isInteger(quantity) || quantity < minQuantity || (maxQuantity !== null && quantity > maxQuantity) || (stock !== null && quantity > stock)) {
      return plan("Enter a whole-number quantity from " + minQuantity + " to " + (Math.min(maxQuantity ?? Number.MAX_SAFE_INTEGER, stock ?? Number.MAX_SAFE_INTEGER) === Number.MAX_SAFE_INTEGER ? "the available limit" : Math.min(maxQuantity ?? Number.MAX_SAFE_INTEGER, stock ?? Number.MAX_SAFE_INTEGER)) + ".", stage, state);
    }
    const cart = arrayOfRecords(state.cart);
    cart.push({
      itemId: product.itemId,
      variantId: product.variantId ?? null,
      name: product.name,
      variantName: product.variantName,
      quantity,
      unitAmount: product.amount,
      currencyCode: product.currencyCode,
      stock: product.stock,
    });
    return plan(
      "Added " + quantity + " × " + asText(product.name, "product") +
      " to your basket.\n\nReply ADD to add another product, or CHECKOUT to continue.",
      "store.cart",
      { ...state, cart },
    );
  }

  if (stage === "store.cart") {
    if (["add", "more", "another"].includes(normalized)) {
      return plan("Choose another product:\n\n" + formatStoreProductChoices(arrayOfRecords(state.products)) + "\n\nReply with a number.", "store.product", state);
    }
    if (["checkout", "done", "finish", "basket"].includes(normalized)) {
      const settings = asRecord(state.settings);
      const methods = Array.isArray(settings.fulfillment_methods) ? settings.fulfillment_methods : [];
      const options = [
        ...(methods.includes("delivery") ? ["1 — Delivery"] : []),
        ...(methods.includes("pickup") ? ["2 — Pickup"] : []),
      ];
      if (!options.length) return plan("Store fulfilment has not been configured. Please contact SKIMA support.", "menu");
      return plan("How should you receive your Store order?\n\n" + options.join("\n") + "\n\nReply with a number.", "store.fulfillment", state);
    }
    return plan("Reply ADD for another product or CHECKOUT to continue.", stage, state);
  }

  if (stage === "store.fulfillment") {
    const settings = asRecord(state.settings);
    const methods = Array.isArray(settings.fulfillment_methods) ? settings.fulfillment_methods : [];
    const fulfillment = input === "1" ? "delivery" : input === "2" ? "pickup" : "";
    if (!fulfillment || !methods.includes(fulfillment)) return plan("Choose an available Store fulfilment method: 1 for delivery or 2 for pickup.", stage, state);
    if (fulfillment === "delivery") {
      const locations = arrayOfRecords(state.locations);
      if (!locations.length) return plan("Add a saved delivery address in the SKIMA app, or reply MENU and choose Store pickup if available.", stage, state);
      return plan("Choose your Store delivery address:\n\n" + formatLocations(locations), "store.location", { ...state, fulfillmentMethod: fulfillment });
    }
    return await prepareWhatsAppStoreCheckout(db, whatsappWaId, item.id, state, "pickup", null);
  }

  if (stage === "store.location") {
    const locations = arrayOfRecords(state.locations);
    const selected = selectNumber(input, locations);
    if (!selected) return plan("Choose one of your saved delivery addresses by number.", stage, state);
    return await prepareWhatsAppStoreCheckout(db, whatsappWaId, item.id, state, "delivery", selected);
  }

  if (stage === "store.payment") {
    if (!["pay", "confirm", "yes", "confirm payment"].includes(normalized)) {
      return plan("Reply PAY to reserve the confirmed Store total from your SKIMA Wallet, or MENU to stop.", stage, state);
    }
    const paid = await db.rpc("skima_whatsapp_store_checkout", {
      target_whatsapp_wa_id: whatsappWaId,
      target_line_items: state.lineItems,
      target_wallet_id: asText(state.walletId, ""),
      target_fulfillment_method: asText(state.fulfillmentMethod, ""),
      target_delivery_location_id: asText(state.deliveryLocationId, "") || null,
      target_customer_note: null,
      target_idempotency_key: asText(state.checkoutKey, ""),
      target_expected_total: numberValue(state.expectedTotal),
      target_confirm_payment: true,
    });
    if (paid.error) return plan("SKIMA could not reserve Store payment: " + safeCustomerError(paid.error.message) + ". The checkout remains unpaid. Top up your wallet if needed, then reply PAY to retry.", stage, state);
    const result = asRecord(paid.data);
    if (result.requiresConfirmation === true || asText(result.status, "") === "awaiting_confirmation") {
      const revisedTotal = numberValue(result.totalAmount);
      return plan("The Store total has changed after a live checkout check. Please review the new total: " + money(revisedTotal ?? 0, asText(result.currencyCode, "NGN")) + ". Reply PAY to approve this updated amount.", stage, { ...state, expectedTotal: revisedTotal, currencyCode: result.currencyCode });
    }
    if (asText(result.status, "") !== "payment_reserved") return plan("The Store order has not reached a confirmed payment-reserved state. Check the app before retrying.", stage, state);
    return plan(
      "✅ Your SKIMA Store order is confirmed and payment is held securely.\nOrder: " + asText(result.orderId, "") +
      "\nTotal reserved: " + money(numberValue(result.totalAmount) ?? 0, asText(result.currencyCode, "NGN")) +
      "\nFulfilment: " + asText(state.fulfillmentMethod, "delivery") +
      "\nSKIMA Store will update your order as it is accepted and prepared. Reply 8 to track it or MENU.",
      "menu",
      {},
    );
  }

  if (
    (stage === "menu" && normalized === "0") ||
    ["notifications", "order notifications", "enable notifications", "enable order updates"].includes(normalized)
  ) {
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
      return plan("There is no eligible saved LPG cylinder linked to this account. Add or verify a cylinder in the SKIMA app, then reply MENU.", "menu");
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
          "Reply 8 to view your orders or MENU for other options.",
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

  if (["6", "fund", "top up", "topup", "wallet"].includes(normalized)) {
    return plan(
      "To fund your wallet securely, open the SKIMA app → Wallet → Top up and complete checkout through the payment provider configured in SKIMA. Return here and reply PAY after the funds show in your wallet. This chat cannot accept payment screenshots, card details, bank PINs or OTPs.",
      "menu",
    );
  }

  if (["7", "pay", "retry payment", "payment"].includes(normalized)) {
    const pendingResult = await db.from("lpg_refill_orders")
      .select("id, public_reference, status, payment_status, total_amount, currency_code, created_at")
      .eq("customer_user_id", profileId)
      .eq("payment_status", "pending")
      .order("created_at", { ascending: false })
      .limit(5);
    if (pendingResult.error) throw pendingResult.error;
    const pending = arrayOfRecords(pendingResult.data);
    if (pending.length === 0) {
      return plan("I couldn't find a pending LPG order for your account. If you recently topped up, check the wallet balance in the app first. Reply 8 to check your orders or MENU.", "menu");
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
      return plan(`✅ Payment reserved. Order ${asText(selected.public_reference, asText(selected.id, ""))} is sent for dispatch. Reply 8 to view your orders or MENU.`, "menu");
    }
    return plan(`Payment is still pending for ${asText(selected.public_reference, "your order")}. ${payment.message} Reply PAY to try again after resolving the issue.`, "payment.pending", { orderId: selected.id, publicReference: selected.public_reference });
  }

  if (["8", "orders", "status", "track", "tracking"].includes(normalized)) {
    const [lpgResult, utilityResult, logisticsJobsResult, logisticsBookingsResult, moduleResult] = await Promise.all([
      db.from("lpg_refill_orders")
        .select("id,public_reference,status,payment_status,total_amount,currency_code,created_at,tracking_session_id")
        .eq("customer_user_id", profileId).order("created_at", { ascending: false }).limit(5),
      db.from("utility_payment_requests")
        .select("id,public_reference,status,total_amount,currency_code,created_at")
        .eq("customer_user_id", profileId).order("created_at", { ascending: false }).limit(5),
      db.from("logistics_job_requests")
        .select("id,title,status,created_at")
        .eq("requester_user_id", profileId).order("created_at", { ascending: false }).limit(5),
      db.from("logistics_bookings")
        .select("id,job_id,status,total_customer_charge,currency_code,created_at")
        .eq("requester_user_id", profileId).order("created_at", { ascending: false }).limit(5),
      db.from("business_modules").select("id,key").in("key", ["fuel", "store"]),
    ]);
    for (const result of [lpgResult, utilityResult, logisticsJobsResult, logisticsBookingsResult, moduleResult]) {
      if (result.error) throw result.error;
    }
    const moduleIds = arrayOfRecords(moduleResult.data).map((row) => asText(row.id, "")).filter(Boolean);
    let commercialOrders: Record<string, unknown>[] = [];
    if (moduleIds.length) {
      const result = await db.from("order_records")
        .select("id,module_id,status,currency_code,total_amount,created_at")
        .eq("requester_user_id", profileId).in("module_id", moduleIds)
        .order("created_at", { ascending: false }).limit(10);
      if (result.error) throw result.error;
      const moduleKeys = new Map(arrayOfRecords(moduleResult.data).map((row) => [asText(row.id, ""), asText(row.key, "Order")]));
      commercialOrders = arrayOfRecords(result.data).map((order) => ({ ...order, moduleKey: moduleKeys.get(asText(order.module_id, "")) ?? "Order" }));
    }
    const lines: string[] = ["Your latest SKIMA orders and requests", ""];
    for (const order of arrayOfRecords(lpgResult.data)) {
      lines.push("LPG " + asText(order.public_reference, asText(order.id, "Order")) + " — " +
        humanizeStatus(asText(order.status, "unknown")) + " / payment " +
        humanizeStatus(asText(order.payment_status, "unknown")) + " — " +
        money(numberValue(order.total_amount) ?? 0, asText(order.currency_code, "NGN")));
      if (["payment_reserved", "assigned", "accepted", "en_route", "driver_arrived", "refilling", "returning", "delivery_arrived"].includes(asText(order.status, "").toLowerCase())) {
        const location = await latestDriverLocation(db, asText(order.id, ""));
        if (location) lines.push("  Latest LPG driver location: https://www.google.com/maps?q=" + location.latitude + "," + location.longitude + " (updated " + formatDate(location.recorded_at) + ")");
      }
    }
    for (const order of commercialOrders) {
      lines.push(asText(order.moduleKey, "Order").toUpperCase() + " " + asText(order.id, "").slice(0, 8).toUpperCase() +
        " — " + humanizeStatus(asText(order.status, "unknown")) + " — " +
        money(numberValue(order.total_amount) ?? 0, asText(order.currency_code, "NGN")));
    }
    for (const bill of arrayOfRecords(utilityResult.data)) {
      lines.push("BILLS " + asText(bill.public_reference, asText(bill.id, "").slice(0, 8).toUpperCase()) +
        " — " + humanizeStatus(asText(bill.status, "unknown")) + " — " +
        money(numberValue(bill.total_amount) ?? 0, asText(bill.currency_code, "NGN")));
    }
    for (const job of arrayOfRecords(logisticsJobsResult.data)) {
      lines.push("LOGISTICS request " + asText(job.id, "").slice(0, 8).toUpperCase() +
        " · " + asText(job.title, "Transport request") + " — " + humanizeStatus(asText(job.status, "unknown")));
    }
    for (const booking of arrayOfRecords(logisticsBookingsResult.data)) {
      lines.push("LOGISTICS booking " + asText(booking.id, "").slice(0, 8).toUpperCase() +
        " — " + humanizeStatus(asText(booking.status, "unknown")) + " — " +
        money(numberValue(booking.total_customer_charge) ?? 0, asText(booking.currency_code, "NGN")));
    }
    if (lines.length === 2) lines.push("No orders or requests were found for your linked SKIMA account yet.");
    lines.push("", "Reply 8 again for fresh status, or MENU to use another SKIMA service.");
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


async function readWhatsAppCustomerWallets(
  db: SupabaseClient,
  profileId: string,
): Promise<Record<string, unknown>[]> {
  const balances = await db.from("wallet_balances")
    .select("wallet_id,currency_code,balance")
    .order("wallet_id", { ascending: true });
  if (balances.error) throw balances.error;
  const balanceRows = arrayOfRecords(balances.data);
  const walletIds = balanceRows.map((row) => asText(row.wallet_id, "")).filter(Boolean);
  if (!walletIds.length) return [];
  const wallets = await db.from("wallet_accounts")
    .select("id,wallet_type,owner_entity_type,owner_entity_id,currency_code,status")
    .in("id", walletIds)
    .eq("wallet_type", "customer")
    .eq("owner_entity_type", "user")
    .eq("owner_entity_id", profileId)
    .eq("status", "active");
  if (wallets.error) throw wallets.error;
  const balanceById = new Map(balanceRows.map((row) => [asText(row.wallet_id, ""), row]));
  return arrayOfRecords(wallets.data).map((wallet) => {
    const balance = balanceById.get(asText(wallet.id, ""));
    return {
      ...wallet,
      currencyCode: asText(wallet.currency_code, "NGN"),
      balance: numberValue(balance?.balance) ?? 0,
    };
  }).sort((left, right) => (numberValue(right.balance) ?? 0) - (numberValue(left.balance) ?? 0));
}

function walletForCurrency(wallets: Record<string, unknown>[], currencyCode: string): Record<string, unknown> | null {
  return wallets.find((wallet) => asText(wallet.currencyCode, "") === currencyCode) ?? null;
}

function isCurrentlyEffective(start: unknown, end: unknown): boolean {
  const now = Date.now();
  const startsAt = typeof start === "string" ? Date.parse(start) : NaN;
  const endsAt = typeof end === "string" ? Date.parse(end) : NaN;
  return (!Number.isFinite(startsAt) || startsAt <= now) && (!Number.isFinite(endsAt) || endsAt > now);
}

function formatFuelOfferChoices(offers: Record<string, unknown>[]): string {
  return offers.slice(0, 8).map((offer, index) => {
    const branch = asRecord(offer.branch);
    const price = numberValue(offer.admin_override_price_per_litre) ?? numberValue(offer.price_per_litre);
    const currency = asText(offer.currency_code, "NGN");
    const modes = Array.isArray(offer.fulfillment_modes) ? offer.fulfillment_modes.join(", ").replace(/_/g, " ") : "";
    const range = (numberValue(offer.minimum_litres) ?? 1) + "–" + (numberValue(offer.maximum_litres) ?? "configured maximum") + " L";
    return (index + 1) + ". " + asText(branch.display_name, asText(offer._branchName, "Fuel station")) +
      (price === null ? "" : " — indicative " + money(price, currency) + "/L") +
      "\n   " + range + (modes ? " · " + modes : "");
  }).join("\n");
}

function maskCustomerIdentifier(value: string): string {
  const compact = value.replace(/\s/g, "");
  if (compact.length <= 4) return "••••";
  return "••••" + compact.slice(-4);
}

function safeCustomerError(message: string): string {
  const sanitized = (message ?? "").replace(/[\r\n]+/g, " ").replace(/(?:bearer\s+)[a-z0-9._-]+/ig, "[redacted]").slice(0, 220);
  if (/insufficient/i.test(sanitized)) return "Your SKIMA Wallet balance is insufficient";
  if (/expired/i.test(sanitized)) return "The quote has expired; please request a fresh quote";
  if (/not available|unavailable|not enabled/i.test(sanitized)) return "This service is not currently available";
  return sanitized || "Please check your details and try again";
}

async function readWhatsAppStoreCatalogue(
  db: SupabaseClient,
): Promise<{ settings: Record<string, unknown>; currencyCode: string; products: Record<string, unknown>[] }> {
  const moduleResult = await db.from("business_modules").select("id,key,status").eq("key", "store").eq("status", "active").maybeSingle();
  if (moduleResult.error) throw moduleResult.error;
  if (!moduleResult.data) return { settings: {}, currencyCode: "NGN", products: [] };
  const settingsResult = await db.from("storefront_settings")
    .select("id,module_id,organization_id,branch_id,currency_code,fulfillment_method,fulfillment_methods,status,minimum_order_amount,delivery_base_fee_amount,free_delivery_minimum_amount,pickup_location_label,pickup_formatted_address,pickup_instructions")
    .eq("module_id", moduleResult.data.id)
    .eq("status", "active")
    .maybeSingle();
  if (settingsResult.error) throw settingsResult.error;
  if (!settingsResult.data) return { settings: {}, currencyCode: "NGN", products: [] };
  const settings = settingsResult.data as Record<string, unknown>;
  const itemResult = await db.from("catalog_items")
    .select("id,organization_id,module_id,category_id,display_name,description,min_quantity,max_quantity,fulfillment_methods,status,metadata")
    .eq("module_id", moduleResult.data.id)
    .eq("organization_id", settings.organization_id)
    .eq("status", "active");
  if (itemResult.error) throw itemResult.error;
  const items = arrayOfRecords(itemResult.data).filter((item) => asText(asRecord(item.metadata).sales_channel, "") === "skima_store");
  if (!items.length) return { settings, currencyCode: asText(settings.currency_code, "NGN"), products: [] };
  const itemIds = items.map((item) => asText(item.id, "")).filter(Boolean);
  const currencyCode = asText(settings.currency_code, "NGN");
  const [variantsResult, pricesResult, availabilityResult] = await Promise.all([
    db.from("catalog_item_variants").select("id,item_id,display_name,status").in("item_id", itemIds).eq("status", "active"),
    db.from("catalog_prices").select("id,item_id,variant_id,currency_code,amount,status,effective_from,effective_until").in("item_id", itemIds).eq("currency_code", currencyCode).eq("status", "active"),
    db.from("catalog_availability_rules").select("id,item_id,variant_id,availability_status,stock_quantity,reserved_quantity,status,effective_from,effective_until").in("item_id", itemIds).eq("status", "active"),
  ]);
  if (variantsResult.error) throw variantsResult.error;
  if (pricesResult.error) throw pricesResult.error;
  if (availabilityResult.error) throw availabilityResult.error;
  const variants = arrayOfRecords(variantsResult.data);
  const prices = arrayOfRecords(pricesResult.data).filter((price) => isCurrentlyEffective(price.effective_from, price.effective_until));
  const availability = arrayOfRecords(availabilityResult.data).filter((rule) => isCurrentlyEffective(rule.effective_from, rule.effective_until));
  const allowedMethods = Array.isArray(settings.fulfillment_methods) ? settings.fulfillment_methods : [];
  const products: Record<string, unknown>[] = [];
  for (const item of items) {
    const itemId = asText(item.id, "");
    const itemMethods = Array.isArray(item.fulfillment_methods) ? item.fulfillment_methods : [];
    if (itemMethods.length && !allowedMethods.some((method) => itemMethods.includes(method))) continue;
    const itemVariants = variants.filter((variant) => asText(variant.item_id, "") === itemId);
    const variantOptions: (Record<string, unknown> | null)[] = itemVariants.length ? itemVariants : [null];
    for (const variant of variantOptions) {
      const variantId = variant ? asText(variant.id, "") : "";
      const price = prices.find((candidate) => asText(candidate.item_id, "") === itemId && asText(candidate.variant_id, "") === variantId) ??
        prices.find((candidate) => asText(candidate.item_id, "") === itemId && !asText(candidate.variant_id, ""));
      const stockRule = availability.find((candidate) => asText(candidate.item_id, "") === itemId && asText(candidate.variant_id, "") === variantId) ??
        availability.find((candidate) => asText(candidate.item_id, "") === itemId && !asText(candidate.variant_id, ""));
      if (!price || !stockRule || asText(stockRule.availability_status, "") !== "available") continue;
      const amount = numberValue(price.amount);
      if (amount === null || amount <= 0) continue;
      const quantity = numberValue(stockRule.stock_quantity);
      const reserved = numberValue(stockRule.reserved_quantity) ?? 0;
      const remaining = quantity === null ? null : Math.max(0, quantity - reserved);
      if (remaining !== null && remaining <= 0) continue;
      const maximum = numberValue(item.max_quantity);
      const maximumQuantity = maximum === null ? remaining : remaining === null ? maximum : Math.min(maximum, remaining);
      products.push({
        itemId,
        variantId: variantId || null,
        name: asText(item.display_name, "Store item"),
        variantName: variant ? asText(variant.display_name, "") : "",
        description: asText(item.description, ""),
        amount,
        currencyCode,
        stock: remaining,
        minQuantity: numberValue(item.min_quantity) ?? 1,
        maxQuantity: maximumQuantity,
      });
    }
  }
  return { settings, currencyCode, products: products.slice(0, 50) };
}

function formatStoreProductChoices(products: Record<string, unknown>[]): string {
  return products.slice(0, 10).map((product, index) =>
    (index + 1) + ". " + asText(product.name, "Store item") +
    (asText(product.variantName, "") ? " — " + asText(product.variantName, "") : "") +
    " · " + money(numberValue(product.amount) ?? 0, asText(product.currencyCode, "NGN")) +
    (numberValue(product.stock) === null ? "" : " · " + numberValue(product.stock) + " available")
  ).join("\n");
}

async function prepareWhatsAppStoreCheckout(
  db: SupabaseClient,
  whatsappWaId: string,
  providerMessageId: string,
  state: Record<string, unknown>,
  fulfillmentMethod: string,
  deliveryLocation: Record<string, unknown> | null,
): Promise<ReplyPlan> {
  const cart = arrayOfRecords(state.cart);
  if (!cart.length) return plan("Your Store basket is empty. Reply MENU to browse products again.", "menu");
  const settings = asRecord(state.settings);
  const currencyCode = asText(settings.currency_code, "NGN");
  const wallet = walletForCurrency(arrayOfRecords(state.wallets), currencyCode);
  if (!wallet) return plan("An active " + currencyCode + " customer wallet is required. Fund your wallet in the SKIMA app and restart checkout.", "menu");
  const subtotal = cart.reduce((sum, item) =>
    sum + (numberValue(item.unitAmount) ?? 0) * (numberValue(item.quantity) ?? 0), 0);
  const freeThreshold = numberValue(settings.free_delivery_minimum_amount);
  const deliveryFee = fulfillmentMethod === "delivery" &&
    !(freeThreshold !== null && subtotal >= freeThreshold)
      ? numberValue(settings.delivery_base_fee_amount) ?? 0
      : 0;
  const estimatedTotal = Math.round((subtotal + deliveryFee) * 100) / 100;
  const minimum = numberValue(settings.minimum_order_amount) ?? 0;
  if (subtotal < minimum) return plan("Your basket is below the current SKIMA Store minimum order of " + money(minimum, currencyCode) + ". Add more products before checkout.", "store.cart", state);
  const lineItems = cart.map((item) => ({
    itemId: asText(item.itemId, ""),
    variantId: asText(item.variantId, "") || null,
    quantity: numberValue(item.quantity) ?? 0,
  }));
  const checkoutKey = await idempotencyKey("store-checkout", providerMessageId);
  const preview = await db.rpc("skima_whatsapp_store_checkout", {
    target_whatsapp_wa_id: whatsappWaId,
    target_line_items: lineItems,
    target_wallet_id: asText(wallet.id, ""),
    target_fulfillment_method: fulfillmentMethod,
    target_delivery_location_id: deliveryLocation ? asText(deliveryLocation.id, "") : null,
    target_customer_note: null,
    target_idempotency_key: checkoutKey,
    target_expected_total: estimatedTotal,
    target_confirm_payment: false,
  });
  if (preview.error) return plan("SKIMA could not prepare Store checkout: " + safeCustomerError(preview.error.message) + ". No wallet payment was taken.", "menu");
  const result = asRecord(preview.data);
  const total = numberValue(result.totalAmount);
  if (total === null || !asText(result.orderId, "")) throw new Error("Store checkout preview did not return the canonical order and total.");
  return plan(
    "Your Store basket is ready. Please review the live checkout total:\n\n" +
    cart.map((line) => asText(line.name, "Item") + " × " + numberValue(line.quantity) + " — " +
      money((numberValue(line.unitAmount) ?? 0) * (numberValue(line.quantity) ?? 0), currencyCode)).join("\n") +
    "\nSubtotal: " + money(numberValue(result.subtotalAmount) ?? subtotal, currencyCode) +
    "\nDelivery: " + money(numberValue(result.deliveryFeeAmount) ?? deliveryFee, currencyCode) +
    "\nTOTAL: " + money(total, currencyCode) +
    "\nFulfilment: " + fulfillmentMethod +
    "\nTo: " + (deliveryLocation ? asText(deliveryLocation.address, asText(deliveryLocation.formatted_address, "Saved address")) : asText(settings.pickup_formatted_address, "Store pickup")) +
    "\n\nReply PAY to reserve this exact amount from your SKIMA Wallet. No payment has been taken yet.",
    "store.payment",
    {
      lineItems,
      walletId: wallet.id,
      fulfillmentMethod,
      deliveryLocationId: deliveryLocation ? deliveryLocation.id : null,
      checkoutKey,
      expectedTotal: total,
      currencyCode,
    },
  );
}

async function readWhatsAppLogisticsOffers(
  db: SupabaseClient,
  profileId: string,
  jobId: string,
): Promise<Record<string, unknown>[]> {
  const job = await db.from("logistics_job_requests")
    .select("id,requester_user_id")
    .eq("id", jobId)
    .eq("requester_user_id", profileId)
    .maybeSingle();
  if (job.error) throw job.error;
  if (!job.data) return [];
  const offersResult = await db.from("logistics_offers")
    .select("id,job_id,organization_id,currency_code,delivery_price_minor,estimated_duration_minutes,status,expires_at,terms")
    .eq("job_id", jobId)
    .eq("status", "submitted")
    .order("created_at", { ascending: true });
  if (offersResult.error) throw offersResult.error;
  const offers = arrayOfRecords(offersResult.data).filter((offer) => isCurrentlyEffective(null, offer.expires_at)).slice(0, 8);
  const organizationIds = [...new Set(offers.map((offer) => asText(offer.organization_id, "")).filter(Boolean))];
  const currencyCodes = [...new Set(offers.map((offer) => asText(offer.currency_code, "")).filter(Boolean))];
  const [orgResult, currencyResult] = await Promise.all([
    organizationIds.length ? db.from("organizations").select("id,display_name,legal_name").in("id", organizationIds) : Promise.resolve({ data: [], error: null }),
    currencyCodes.length ? db.from("currency_definitions").select("code,decimal_places").in("code", currencyCodes) : Promise.resolve({ data: [], error: null }),
  ]);
  if (orgResult.error) throw orgResult.error;
  if (currencyResult.error) throw currencyResult.error;
  const orgs = new Map(arrayOfRecords(orgResult.data).map((organization) => [asText(organization.id, ""), organization]));
  const decimals = new Map(arrayOfRecords(currencyResult.data).map((currency) => [asText(currency.code, ""), numberValue(currency.decimal_places) ?? 2]));
  return offers.map((offer) => {
    const organization = orgs.get(asText(offer.organization_id, "")) ?? {};
    const currency = asText(offer.currency_code, "NGN");
    const places = decimals.get(currency) ?? 2;
    const amount = (numberValue(offer.delivery_price_minor) ?? 0) / Math.pow(10, places);
    return { ...offer, providerName: asText(organization.display_name, asText(organization.legal_name, "Logistics provider")), deliveryAmount: amount };
  });
}

function formatLogisticsOfferChoices(offers: Record<string, unknown>[]): string {
  return offers.slice(0, 8).map((offer, index) =>
    (index + 1) + ". " + asText(offer.providerName, "Provider") +
    " — " + money(numberValue(offer.deliveryAmount) ?? 0, asText(offer.currency_code, "NGN")) +
    (numberValue(offer.estimated_duration_minutes) === null ? "" : " · about " + numberValue(offer.estimated_duration_minutes) + " minutes") +
    (asText(offer.expires_at, "") ? " · expires " + formatDate(offer.expires_at) : "")
  ).join("\n");
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

async function dispatchWhatsAppOutboxes(request: Request): Promise<Response> {
  const [ordersResponse, supportResponse] = await Promise.all([
    dispatchOrderStatusNotifications(request),
    dispatchSupportOutbox(request),
  ]);
  const [orders, support] = await Promise.all([
    ordersResponse.json().catch(() => ({ ok: false, error: "order_dispatch_response_invalid" })),
    supportResponse.json().catch(() => ({ ok: false, error: "support_dispatch_response_invalid" })),
  ]);
  const ok = ordersResponse.ok && supportResponse.ok;
  const status = !ordersResponse.ok ? ordersResponse.status : !supportResponse.ok ? supportResponse.status : 200;
  return json({ ok, orders, support }, status);
}

async function dispatchSupportOutbox(request: Request): Promise<Response> {
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
  if (!/^v\\d+\\.\\d+$/.test(graphVersion)) {
    return json({ ok: false, error: "invalid_graph_api_version_configuration" }, 500);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const claimedResult = await db.rpc("claim_skima_whatsapp_support_outbox", { target_limit: 25 });
  if (claimedResult.error) {
    console.error(JSON.stringify({ event: "whatsapp_support_outbox_claim_failed", code: "claim_failed" }));
    return json({ ok: false, error: "support_notification_queue_unavailable" }, 500);
  }

  const claimed = arrayOfRecords(claimedResult.data);
  let sent = 0;
  let queuedForRetry = 0;
  let deadLettered = 0;
  for (const item of claimed) {
    const notificationId = asText(item.notification_id, "");
    const recipient = asText(item.whatsapp_wa_id, "");
    const attempt = numberValue(item.attempt_count) ?? 1;
    const body = asText(item.body, "");
    if (!notificationId || !/^[0-9]{6,20}$/.test(recipient) || !body) {
      if (notificationId) {
        await db.from("skima_whatsapp_support_outbox")
          .update({
            status: "failed",
            locked_at: null,
            last_error_code: "invalid_support_notification",
            updated_at: new Date().toISOString(),
          })
          .eq("id", notificationId)
          .eq("status", "processing");
      }
      deadLettered += 1;
      continue;
    }

    const result = await sendWhatsAppTextWithReceipt({
      accessToken, graphVersion, phoneNumberId, recipient, text: body,
    });
    if (result.ok) {
      const saved = await db.from("skima_whatsapp_support_outbox")
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
        console.error(JSON.stringify({ event: "whatsapp_support_sent_but_not_recorded", notificationId }));
      } else {
        sent += 1;
      }
      continue;
    }

    const retry = result.retryable && attempt < 8;
    const delayMinutes = Math.min(360, Math.max(1, 2 ** Math.min(attempt, 8)));
    const saved = await db.from("skima_whatsapp_support_outbox")
      .update({
        status: retry ? "queued" : "failed",
        next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
        locked_at: null,
        last_error_code: result.errorCode,
        updated_at: new Date().toISOString(),
      })
      .eq("id", notificationId)
      .eq("status", "processing");
    if (saved.error) {
      console.error(JSON.stringify({ event: "whatsapp_support_failure_not_recorded", notificationId }));
    }
    if (retry) queuedForRetry += 1;
    else deadLettered += 1;
  }
  return json({ ok: true, claimed: claimed.length, sent, queuedForRetry, deadLettered });
}

async function sendWhatsAppTextWithReceipt(args: {
  accessToken: string; graphVersion: string; phoneNumberId: string; recipient: string; text: string;
}): Promise<
  | { ok: true; providerMessageId: string | null }
  | { ok: false; errorCode: string; retryable: boolean }
> {
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
      errorCode: `meta_${code}`.slice(0,180),
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

    // The customer can opt out after a batch is claimed. Recheck consent immediately
    // before each provider send; a failed consent read must never result in delivery.
    const consentResult = await db.from("skima_whatsapp_contacts")
      .select("id")
      .eq("whatsapp_wa_id", recipient)
      .eq("link_status", "linked")
      .eq("order_status_notifications_opt_in", true)
      .maybeSingle();
    if (consentResult.error) {
      const retry = attempt < 8;
      const delayMinutes = Math.min(360, Math.max(1, 2 ** Math.min(attempt, 8)));
      const saved = await db.from("skima_whatsapp_order_notifications")
        .update({
          status: retry ? "queued" : "failed",
          next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
          locked_at: null,
          last_error_code: "notification_consent_check_failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", notificationId)
        .eq("status", "processing");
      if (saved.error) {
        console.error(JSON.stringify({ event: "whatsapp_outbox_consent_check_failure_not_recorded", notificationId }));
      }
      if (retry) queuedForRetry += 1;
      else deadLettered += 1;
      continue;
    }
    if (!consentResult.data) {
      const saved = await db.from("skima_whatsapp_order_notifications")
        .update({
          status: "cancelled",
          locked_at: null,
          last_error_code: "customer_opted_out",
          updated_at: new Date().toISOString(),
        })
        .eq("id", notificationId)
        .eq("status", "processing");
      if (saved.error) {
        console.error(JSON.stringify({ event: "whatsapp_outbox_optout_cancel_failed", notificationId }));
      }
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
