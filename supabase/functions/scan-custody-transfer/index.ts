// SKIMA EDGE FUNCTION: SCAN CUSTODY TRANSFER & SETTLEMENT RELEASE
// Path: supabase/functions/scan-custody-transfer/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function releaseEscrowToWallet(
  adminClient: any,
  params: {
    customerId: string;
    destinationUserId: string;
    amount: number;
    reference: string;
    transactionType: "ESCROW_RELEASE_STATION" | "ESCROW_RELEASE_DRIVER";
    orderId: string;
    settlementType: string;
    nextEscrowStatus: "PARTIALLY_RELEASED" | "RELEASED";
  },
) {
  const { data: customerWallet, error: customerWalletError } = await adminClient
    .from("wallets")
    .select("id, locked_balance")
    .eq("user_id", params.customerId)
    .single();

  if (customerWalletError || !customerWallet) {
    throw new Error("Customer escrow wallet not found");
  }

  const lockedBalance = Number(customerWallet.locked_balance);
  if (lockedBalance < params.amount) {
    throw new Error("Insufficient locked escrow balance for settlement release");
  }

  const { data: destinationWallet, error: destinationWalletError } = await adminClient
    .from("wallets")
    .select("id, balance")
    .eq("user_id", params.destinationUserId)
    .single();

  if (destinationWalletError || !destinationWallet) {
    throw new Error("Settlement destination wallet not found");
  }

  await adminClient
    .from("wallets")
    .update({
      locked_balance: lockedBalance - params.amount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", customerWallet.id);

  await adminClient
    .from("wallets")
    .update({
      balance: Number(destinationWallet.balance) + params.amount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", destinationWallet.id);

  await adminClient.from("ledger_entries").insert({
    reference: params.reference,
    transaction_type: params.transactionType,
    source_wallet_id: customerWallet.id,
    destination_wallet_id: destinationWallet.id,
    amount: params.amount,
    currency: "NGN",
    status: "COMPLETED",
    metadata: { order_id: params.orderId, type: params.settlementType },
  });

  await adminClient
    .from("gas_orders")
    .update({ escrow_status: params.nextEscrowStatus, updated_at: new Date().toISOString() })
    .eq("id", params.orderId);
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
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for custody settlement writes");
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

    const { orderId, qrCode, lat, lng, photoUrl } = await req.json();

    if (!orderId || !qrCode) {
      return new Response(JSON.stringify({ error: "Missing orderId or qrCode" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: order, error: orderError } = await adminClient
      .from("gas_orders")
      .select("*, cylinder:cylinders(*)")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!order.cylinder || order.cylinder.qr_code !== qrCode) {
      return new Response(JSON.stringify({ error: "Invalid cylinder QR code for this order" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: actorProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profileError || !actorProfile) {
      return new Response(JSON.stringify({ error: "Actor profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let stationOwnerUserId: string | undefined;
    let isAssignedStationOperator = false;

    if (order.station_id && (actorProfile.is_station_admin || actorProfile.is_pump_attendant)) {
      const { data: station } = await adminClient
        .from("lpg_stations")
        .select("owner_user_id")
        .eq("id", order.station_id)
        .single();

      stationOwnerUserId = station?.owner_user_id;

      if (actorProfile.is_station_admin && stationOwnerUserId === user.id) {
        isAssignedStationOperator = true;
      }

      if (actorProfile.is_pump_attendant) {
        const { data: attendant } = await adminClient
          .from("station_attendants")
          .select("id")
          .eq("station_id", order.station_id)
          .eq("user_id", user.id)
          .eq("is_active", true)
          .maybeSingle();

        isAssignedStationOperator = Boolean(attendant);
      }
    }

    const isAssignedDriver = actorProfile.is_driver && user.id === order.driver_id;
    let nextOrderStatus = order.status;
    let nextCylinderStatus = order.cylinder.status;
    let nextCustodyUser = order.cylinder.current_custody_user_id;
    let escrowTrigger: "NONE" | "STATION_PAYMENT" | "FULL_ORDER_COMPLETION" = "NONE";

    if (order.status === "ASSIGNED_TO_DRIVER" && isAssignedDriver) {
      nextOrderStatus = "CYLINDER_PICKED_UP";
      nextCylinderStatus = "IN_TRANSIT_TO_STATION";
      nextCustodyUser = user.id;
    } else if (order.status === "CYLINDER_PICKED_UP" && isAssignedStationOperator) {
      nextOrderStatus = "DELIVERED_TO_STATION";
      nextCylinderStatus = "AT_STATION";
      nextCustodyUser = user.id;
    } else if (order.status === "DELIVERED_TO_STATION" && isAssignedStationOperator) {
      nextOrderStatus = "REFILL_COMPLETED";
      nextCylinderStatus = "REFILLED";
      nextCustodyUser = user.id;
      escrowTrigger = "STATION_PAYMENT";
    } else if (order.status === "REFILL_COMPLETED" && isAssignedDriver) {
      nextOrderStatus = "RETURN_IN_TRANSIT";
      nextCylinderStatus = "IN_TRANSIT_TO_CUSTOMER";
      nextCustodyUser = user.id;
    } else if (order.status === "RETURN_IN_TRANSIT" && user.id === order.customer_id) {
      nextOrderStatus = "COMPLETED";
      nextCylinderStatus = "IDLE";
      nextCustodyUser = order.customer_id;
      escrowTrigger = "FULL_ORDER_COMPLETION";
    } else {
      return new Response(
        JSON.stringify({ error: `Invalid transition for order status ${order.status} by this actor.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    await adminClient
      .from("cylinders")
      .update({
        current_custody_user_id: nextCustodyUser,
        status: nextCylinderStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.cylinder_id);

    await adminClient
      .from("gas_orders")
      .update({
        status: nextOrderStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    await adminClient.from("order_timeline").insert({
      order_id: order.id,
      event_type: nextOrderStatus,
      actor_user_id: user.id,
      latitude: lat,
      longitude: lng,
      photo_url: photoUrl,
      notes: `Custody transition verified: ${nextCylinderStatus}.`,
    });

    if (escrowTrigger === "STATION_PAYMENT") {
      if (!stationOwnerUserId) {
        throw new Error("Assigned station owner not found for settlement");
      }

      await releaseEscrowToWallet(adminClient, {
        customerId: order.customer_id,
        destinationUserId: stationOwnerUserId,
        amount: Number(order.gas_cost),
        reference: `SETTLE-STATION-${order.public_id}`,
        transactionType: "ESCROW_RELEASE_STATION",
        orderId: order.id,
        settlementType: "STATION_REFILL_PAYOUT",
        nextEscrowStatus: "PARTIALLY_RELEASED",
      });
    }

    if (escrowTrigger === "FULL_ORDER_COMPLETION") {
      if (!order.driver_id) {
        throw new Error("Assigned driver not found for settlement");
      }

      await releaseEscrowToWallet(adminClient, {
        customerId: order.customer_id,
        destinationUserId: order.driver_id,
        amount: Number(order.delivery_fee),
        reference: `SETTLE-DRIVER-${order.public_id}`,
        transactionType: "ESCROW_RELEASE_DRIVER",
        orderId: order.id,
        settlementType: "DRIVER_COMMISSION_PAYOUT",
        nextEscrowStatus: "RELEASED",
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        orderId: order.id,
        newOrderStatus: nextOrderStatus,
        newCylinderStatus: nextCylinderStatus,
        escrowTrigger,
        message: "Custody transfer scan verified and processed successfully.",
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
