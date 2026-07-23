// SKIMA EDGE FUNCTION: AI AGENT 4 — FRAUD DETECTION & ANOMALY ALERTS
// Path: supabase/functions/ai-fraud-detection/index.ts

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
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { eventType, userId, orderId, metadata } = await req.json();

    let riskScore = 0.1;
    let riskCategory = "LOW";
    let isFlagged = false;
    let anomalyDescription = "Normal operational parameters.";

    if (eventType === "DELIVERY_COMPLETED") {
      const durationMinutes = metadata?.durationMinutes || 10;
      const distanceKm = metadata?.distanceKm || 5.0;

      if (durationMinutes < 2 && distanceKm > 1.0) {
        riskScore = 0.95;
        riskCategory = "CRITICAL";
        isFlagged = true;
        anomalyDescription = `Impossibly rapid delivery: ${distanceKm}km reported completed in ${durationMinutes} minutes.`;
      }
    } else if (eventType === "FAILED_DEPOSIT_ATTEMPT") {
      const failedCount = metadata?.failedCount || 1;
      if (failedCount >= 5) {
        riskScore = 0.88;
        riskCategory = "HIGH";
        isFlagged = true;
        anomalyDescription = `Multiple failed deposit attempts (${failedCount}) detected within 1 hour.`;
      }
    }

    // Log audit record if flagged
    if (isFlagged) {
      await supabaseClient.from("audit_logs").insert({
        actor_id: userId || null,
        action: `AI_FRAUD_ALERT_${riskCategory}`,
        target_table: eventType === "DELIVERY_COMPLETED" ? "gas_orders" : "wallets",
        target_id: orderId || null,
        payload: { eventType, riskScore, anomalyDescription, metadata },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        isFlagged,
        riskScore,
        riskCategory,
        anomalyDescription,
        recommendedAction: isFlagged ? "FLAG_FOR_ADMIN_REVIEW" : "ALLOW",
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
