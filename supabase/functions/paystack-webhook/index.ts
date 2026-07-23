// SKIMA EDGE FUNCTION: PAYSTACK WEBHOOK & ATOMIC WALLET FUNDING
// Path: supabase/functions/paystack-webhook/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-paystack-signature",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!serviceRoleKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for webhook wallet funding");
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json();

    // Verify event is charge.success
    if (body.event === "charge.success") {
      const data = body.data;
      const reference = data.reference;
      const amountNgn = data.amount / 100; // Paystack sends kobo
      const customerEmail = data.customer?.email;

      if (!customerEmail || !reference) {
        return new Response(JSON.stringify({ message: "Ignored: Missing email or reference" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Find user profile by email
      const { data: profile, error: profileError } = await adminClient
        .from("profiles")
        .select("id")
        .eq("email", customerEmail)
        .single();

      if (profileError || !profile) {
        return new Response(JSON.stringify({ message: "Ignored: User profile not found" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check if reference already processed
      const { data: existingLedger } = await adminClient
        .from("ledger_entries")
        .select("id")
        .eq("reference", reference)
        .maybeSingle();

      if (existingLedger) {
        return new Response(JSON.stringify({ message: "Webhook already processed" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fund user wallet using atomic procedure / update
      const { data: wallet, error: walletError } = await adminClient
        .from("wallets")
        .select("id, balance")
        .eq("user_id", profile.id)
        .single();

      if (walletError || !wallet) {
        throw new Error(`Wallet not found for profile ${profile.id}`);
      }

      await adminClient
        .from("wallets")
        .update({
          balance: Number(wallet.balance) + amountNgn,
          updated_at: new Date().toISOString(),
        })
        .eq("id", wallet.id);

      await adminClient.from("ledger_entries").insert({
        reference,
        transaction_type: "DEPOSIT",
        destination_wallet_id: wallet.id,
        amount: amountNgn,
        currency: "NGN",
        status: "COMPLETED",
        metadata: { provider: "PAYSTACK", gateway_id: data.id, channel: data.channel },
      });

      // Notification
      await adminClient.from("notifications").insert({
        user_id: profile.id,
        channel: "IN_APP",
        title: "Wallet Funded Successfully",
        body: `Your Skima wallet has been credited with ₦${amountNgn.toLocaleString()} via Paystack.`,
      });
    }

    return new Response(JSON.stringify({ status: "success" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
