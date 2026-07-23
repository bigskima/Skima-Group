// SKIMA EDGE FUNCTION: MARKETPLACE CHECKOUT & ESCROW LOCK
// Path: supabase/functions/marketplace-checkout/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!serviceRoleKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for marketplace escrow operations");
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

    const { productId, quantity, deliveryAddress } = await req.json();

    if (!productId || !quantity || quantity <= 0) {
      return new Response(JSON.stringify({ error: "Invalid product or quantity" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch product details
    const { data: product, error: productError } = await adminClient
      .from("merchant_products")
      .select("*, merchant:merchants(*)")
      .eq("id", productId)
      .single();

    if (productError || !product) {
      return new Response(JSON.stringify({ error: "Product not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (product.stock_quantity < quantity) {
      return new Response(
        JSON.stringify({ error: `Insufficient stock. Only ${product.stock_quantity} available.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const subtotal = Number(product.price) * quantity;
    const deliveryFee = 1000.0;
    const totalAmount = subtotal + deliveryFee;

    // Check user wallet balance
    const { data: wallet, error: walletError } = await adminClient
      .from("wallets")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (walletError || !wallet || Number(wallet.balance) < totalAmount) {
      return new Response(JSON.stringify({ error: "Insufficient wallet balance to lock escrow" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Lock Escrow & deduct wallet balance
    await adminClient
      .from("wallets")
      .update({
        balance: Number(wallet.balance) - totalAmount,
        locked_balance: Number(wallet.locked_balance) + totalAmount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", wallet.id);

    // Reserve stock
    await adminClient
      .from("merchant_products")
      .update({
        stock_quantity: product.stock_quantity - quantity,
        updated_at: new Date().toISOString(),
      })
      .eq("id", product.id);

    const publicId = `ORD-MKT-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

    // Create Marketplace Order
    const { data: order, error: orderInsertError } = await adminClient
      .from("marketplace_orders")
      .insert({
        public_id: publicId,
        customer_id: user.id,
        merchant_id: product.merchant_id,
        subtotal,
        delivery_fee: deliveryFee,
        total_amount: totalAmount,
        currency: "NGN",
        status: "ESCROW_LOCKED",
        escrow_status: "LOCKED",
        delivery_address: deliveryAddress ?? "Awka Launch Area",
      })
      .select()
      .single();

    if (orderInsertError || !order) {
      throw new Error(`Failed to create marketplace order: ${orderInsertError?.message}`);
    }

    // Create Order Item
    await adminClient.from("marketplace_order_items").insert({
      marketplace_order_id: order.id,
      product_id: product.id,
      quantity,
      unit_price: product.price,
      line_total: subtotal,
    });

    // Log Escrow Record
    await adminClient.from("escrow_records").insert({
      source_module: "MARKETPLACE",
      source_id: order.id,
      customer_id: user.id,
      wallet_id: wallet.id,
      amount: totalAmount,
      currency: "NGN",
      status: "LOCKED",
    });

    return new Response(
      JSON.stringify({
        success: true,
        orderId: order.id,
        publicId: order.public_id,
        totalAmount,
        message: "Marketplace checkout completed. Funds locked in Skima Escrow.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
