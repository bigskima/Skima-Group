import { createClient } from "npm:@supabase/supabase-js@2.110.9";

const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const MAX_BATCH = 100;
const MAX_ATTEMPTS = 8;

type OutboxRow = {
  id: string;
  registration_id: string | null;
  user_id: string;
  app_key: "refill" | "store" | "logistics" | "bills";
  expo_push_token: string;
  expo_project_id: string | null;
  title: string;
  body: string;
  data: Record<string, unknown>;
  attempts: number;
  provider_ticket_id: string | null;
};

type ExpoTicket = {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string; [key: string]: unknown };
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: "server_misconfigured" }, 500);

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${serviceRoleKey}`) return json({ ok: false, error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });

  const batchSize = await readBatchSize(request);
  const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  const totals = { claimed: 0, sent: 0, failed: 0, receiptsChecked: 0, invalidTokens: 0 };

  try {
    const claimed = await supabase.rpc("claim_skima_push_outbox", { target_limit: batchSize });
    if (claimed.error) throw claimed.error;
    const rows = Array.isArray(claimed.data) ? claimed.data as OutboxRow[] : [];
    totals.claimed = rows.length;

    for (let offset = 0; offset < rows.length; offset += MAX_BATCH) {
      const batch = rows.slice(offset, offset + MAX_BATCH);
      const messages = batch.map((row) => ({
        to: row.expo_push_token,
        title: row.title,
        body: row.body,
        data: { ...row.data, appKey: row.app_key },
        sound: "default",
        priority: "high",
        channelId: row.app_key,
      }));
      const response = await fetch(EXPO_SEND_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(messages),
      });
      const payload = await response.json().catch(() => null) as { data?: ExpoTicket[]; errors?: unknown[] } | null;
      if (!response.ok || !payload || !Array.isArray(payload.data)) {
        const message = `Expo push send failed with HTTP ${response.status}.`;
        const retryAt = new Date(Date.now() + 30_000).toISOString();
        const updates = await Promise.all(batch.map((row) => supabase.from("push_notification_outbox").update({
          status: row.attempts >= MAX_ATTEMPTS ? "failed" : "queued",
          next_attempt_at: retryAt,
          last_error: message,
          updated_at: new Date().toISOString(),
        }).eq("id", row.id)));
        const updateError = updates.find((result) => result.error)?.error;
        if (updateError) throw updateError;
        totals.failed += batch.length;
        continue;
      }

      for (let index = 0; index < batch.length; index += 1) {
        const row = batch[index];
        const ticket = payload.data[index] ?? { status: "error", message: "Expo returned no ticket for this message." };
        const now = new Date().toISOString();
        if (ticket.status === "ok" && ticket.id) {
          const { error } = await supabase.from("push_notification_outbox").update({
            status: "sent",
            provider_ticket_id: ticket.id,
            provider_response: ticket,
            sent_at: now,
            updated_at: now,
            last_error: null,
          }).eq("id", row.id);
          if (error) throw error;
          totals.sent += 1;
          continue;
        }

        const errorCode = ticket.details?.error ?? "expo_push_failed";
        const invalidToken = errorCode === "DeviceNotRegistered";
        const retryAfterSeconds = Math.min(3600, 15 * (2 ** Math.max(0, row.attempts - 1)));
        const terminal = invalidToken || row.attempts >= MAX_ATTEMPTS;
        const { error } = await supabase.from("push_notification_outbox").update({
          status: terminal ? "failed" : "queued",
          next_attempt_at: new Date(Date.now() + retryAfterSeconds * 1000).toISOString(),
          provider_response: ticket,
          updated_at: now,
          last_error: String(ticket.message ?? errorCode).slice(0, 1000),
        }).eq("id", row.id);
        if (error) throw error;
        if (invalidToken && row.registration_id) {
          const registration = await supabase.from("push_device_registrations").update({
            is_active: false,
            permission_status: "denied",
            updated_at: now,
          }).eq("id", row.registration_id);
          if (registration.error) throw registration.error;
          totals.invalidTokens += 1;
        }
        totals.failed += 1;
      }
    }

    const receipts = await processReceipts(supabase, accessToken);
    totals.receiptsChecked = receipts.checked;
    totals.invalidTokens += receipts.invalidTokens;

    return json({ ok: true, data: totals });
  } catch (error) {
    console.error(JSON.stringify({
      source: "skima-push-dispatch",
      error: error instanceof Error ? error.message : "unknown",
      totals,
    }));
    return json({ ok: false, error: "push_dispatch_failed", data: totals }, 500);
  }
});

async function processReceipts(
  supabase: ReturnType<typeof createClient>,
  accessToken: string | undefined,
): Promise<{ checked: number; invalidTokens: number }> {
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data, error } = await supabase.from("push_notification_outbox")
    .select("id,registration_id,provider_ticket_id")
    .eq("status", "sent")
    .not("provider_ticket_id", "is", null)
    .or(`last_receipt_checked_at.is.null,last_receipt_checked_at.lt.${cutoff}`)
    .order("sent_at", { ascending: true })
    .limit(1000);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ id: string; registration_id: string | null; provider_ticket_id: string }>;
  let checked = 0;
  let invalidTokens = 0;

  for (let offset = 0; offset < rows.length; offset += 1000) {
    const batch = rows.slice(offset, offset + 1000);
    const ids = batch.map((row) => row.provider_ticket_id);
    const response = await fetch(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) continue;
    const payload = await response.json().catch(() => null) as { data?: Record<string, ExpoTicket> } | null;
    if (!payload?.data) continue;

    for (const row of batch) {
      const receipt = payload.data[row.provider_ticket_id];
      if (!receipt) continue;
      const now = new Date().toISOString();
      const errorCode = receipt.details?.error ?? null;
      const { error: updateError } = await supabase.from("push_notification_outbox").update({
        provider_receipt_status: receipt.status ?? "unknown",
        provider_response: receipt,
        last_receipt_checked_at: now,
        last_error: errorCode ? String(receipt.message ?? errorCode).slice(0, 1000) : null,
        status: receipt.status === "error" ? "receipt_error" : "sent",
        updated_at: now,
      }).eq("id", row.id);
      if (updateError) throw updateError;
      checked += 1;

      if (errorCode === "DeviceNotRegistered" && row.registration_id) {
        const { error: tokenError } = await supabase.from("push_device_registrations").update({
          is_active: false,
          permission_status: "denied",
          updated_at: now,
        }).eq("id", row.registration_id);
        if (tokenError) throw tokenError;
        invalidTokens += 1;
      }
    }
  }
  return { checked, invalidTokens };
}

async function readBatchSize(request: Request): Promise<number> {
  if (!request.headers.get("content-type")?.includes("application/json")) return 100;
  try {
    const value = await request.json() as { batchSize?: unknown };
    return typeof value.batchSize === "number" && Number.isInteger(value.batchSize)
      ? Math.max(1, Math.min(value.batchSize, 500))
      : 100;
  } catch {
    return 100;
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" } });
}
