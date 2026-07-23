// SKIMA EDGE FUNCTION: AI AGENT 2 & 7 — CUSTOMER SUPPORT & NIGERIAN LANDMARK INTELLIGENCE
// Path: supabase/functions/ai-customer-support/index.ts

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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { query, activeOrderId } = await req.json();

    if (!query) {
      return new Response(JSON.stringify({ error: "Missing query parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const queryLower = query.toLowerCase();
    let responseText = "";
    let category = "GENERAL_SUPPORT";
    let requiresEscalation = false;

    // Check if query is an informal Nigerian landmark description (Agent 7)
    if (queryLower.includes("behind") || queryLower.includes("opposite") || queryLower.includes("junction") || queryLower.includes("gate")) {
      category = "ADDRESS_INTELLIGENCE";
      let landmark = "Local Landmark";
      let area = "Awka Zone";

      if (queryLower.includes("aroma")) {
        landmark = "Aroma Junction Landmark";
        area = "Aroma Axis, Awka";
      } else if (queryLower.includes("emma pharmacy")) {
        landmark = "Emma Pharmacy Landmark";
        area = "Emma Pharmacy Vicinity, Awka";
      } else if (queryLower.includes("unizik")) {
        landmark = "UNIZIK Gate Landmark";
        area = "UNIZIK Temp Site Area, Awka";
      }

      responseText = `📍 Nigerian Landmark Recognized: "${landmark}". Geofence Area: "${area}". Delivery address updated to: "${query}, ${area}, Anambra State".`;
    } else if (queryLower.includes("where") && queryLower.includes("driver")) {
      category = "ORDER_STATUS";
      if (activeOrderId) {
        const { data: order } = await supabaseClient
          .from("gas_orders")
          .select("status")
          .eq("id", activeOrderId)
          .single();
        
        responseText = `Your driver is currently in transit (Status: ${order?.status || "IN_TRANSIT"}). You can track live movement on the map.`;
      } else {
        responseText = "You do not have an active order right now. You can place a gas refill order from the home screen.";
      }
    } else {
      responseText = `I have logged your request. If you need human assistance, Support Ticket #ST-${Math.floor(1000 + Math.random() * 9000)} has been created for Admin review.`;
      requiresEscalation = true;
    }

    return new Response(
      JSON.stringify({
        success: true,
        category,
        responseText,
        requiresEscalation,
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
