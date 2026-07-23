// SKIMA EDGE FUNCTION: CREATE GAS ORDER & ESCROW LOCK
// Path: supabase/functions/create-gas-order/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function configNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!serviceRoleKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for gas order writes");
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const cylinderId = body.cylinderId as string | undefined;
    const quantityKg = Number(body.quantityKg);
    const deliveryAddress = body.deliveryAddress as string | undefined;
    const deliveryLat = Number(body.deliveryLat);
    const deliveryLng = Number(body.deliveryLng);
    const deliveryDistanceKm = Math.max(0, Number(body.deliveryDistanceKm ?? 0));

    if (
      !cylinderId ||
      !Number.isFinite(quantityKg) ||
      quantityKg <= 0 ||
      !deliveryAddress ||
      !Number.isFinite(deliveryLat) ||
      !Number.isFinite(deliveryLng)
    ) {
      return new Response(JSON.stringify({ error: "Missing or invalid order parameters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: configs } = await adminClient
      .from("system_configurations")
      .select("key, value")
      .in("key", ["GAS_PRICE_PER_KG_NGN", "DELIVERY_BASE_FEE_NGN", "DELIVERY_PER_KM_FEE_NGN"]);

    const configByKey = new Map((configs ?? []).map((config) => [config.key, config.value]));
    const pricePerKg = configNumber(configByKey.get("GAS_PRICE_PER_KG_NGN"), 1400);
    const deliveryBaseFee = configNumber(configByKey.get("DELIVERY_BASE_FEE_NGN"), 500);
    const deliveryPerKmFee = configNumber(configByKey.get("DELIVERY_PER_KM_FEE_NGN"), 150);
    const gasCost = Math.round(quantityKg * pricePerKg);
    const deliveryFee = Math.round(deliveryBaseFee + deliveryDistanceKm * deliveryPerKmFee);
    const totalAmount = gasCost + deliveryFee;

    const { data: wallet, error: walletError } = await adminClient
      .from("wallets")
      .select("id, balance, locked_balance")
      .eq("user_id", user.id)
      .single();

    if (walletError || !wallet || Number(wallet.balance) < totalAmount) {
      return new Response(
        JSON.stringify({ error: "Insufficient wallet balance. Please fund your wallet first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const publicId = `ORD-LPG-${Math.floor(100000 + Math.random() * 900000)}`;

    const { data: order, error: orderError } = await adminClient
      .from("gas_orders")
      .insert({
        public_id: publicId,
        customer_id: user.id,
        cylinder_id: cylinderId,
        quantity_kg: quantityKg,
        gas_cost: gasCost,
        delivery_fee: deliveryFee,
        total_amount: totalAmount,
        status: "CREATED",
        delivery_address: deliveryAddress,
        delivery_latitude: deliveryLat,
        delivery_longitude: deliveryLng,
        escrow_status: "PENDING",
      })
      .select()
      .single();

    if (orderError || !order) {
      throw new Error(`Failed to create order record: ${orderError?.message ?? "unknown error"}`);
    }

    const { error: escrowError } = await adminClient.rpc("lock_order_escrow", {
      p_customer_id: user.id,
      p_order_id: order.id,
      p_amount: totalAmount,
    });

    if (escrowError) {
      throw new Error(`Failed to lock escrow funds: ${escrowError.message}`);
    }

    await adminClient.from("ledger_entries").insert({
      reference: `ESCROW-HOLD-${publicId}`,
      transaction_type: "ESCROW_HOLD",
      source_wallet_id: wallet.id,
      amount: totalAmount,
      currency: "NGN",
      status: "COMPLETED",
      metadata: {
        order_id: order.id,
        gas_cost: gasCost,
        delivery_fee: deliveryFee,
        delivery_distance_km: deliveryDistanceKm,
      },
    });

    await adminClient.from("order_timeline").insert({
      order_id: order.id,
      event_type: "ESCROW_LOCKED",
      actor_user_id: user.id,
      latitude: deliveryLat,
      longitude: deliveryLng,
      notes: `Order created. ${totalAmount} NGN locked in escrow.`,
    });

    const { data: lockedOrder } = await adminClient
      .from("gas_orders")
      .select("*")
      .eq("id", order.id)
      .single();

    return new Response(
      JSON.stringify({
        success: true,
        order: lockedOrder ?? order,
        quote: {
          currency: "NGN",
          pricePerKg,
          gasCost,
          deliveryFee,
          totalAmount,
        },
        message: "Order placed successfully. Funds locked in escrow.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
