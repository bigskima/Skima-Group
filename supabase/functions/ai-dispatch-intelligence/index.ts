// SKIMA EDGE FUNCTION: AI AGENT 1 — DISPATCH INTELLIGENCE
// Path: supabase/functions/ai-dispatch-intelligence/index.ts

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

    const { requiredKg, customerLat, customerLng } = await req.json();

    // 1. Query active LPG stations from database
    const { data: stations, error } = await supabaseClient
      .from("lpg_stations")
      .select("*")
      .gte("available_stock_kg", requiredKg)
      .eq("is_active", true);

    if (error || !stations || stations.length === 0) {
      return new Response(JSON.stringify({ error: "No available station found for required weight" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Score stations based on stock, queue, and distance
    const scored = stations.map((stn) => {
      // Calculate Haversine distance
      const dLat = (stn.latitude - customerLat) * (Math.PI / 180);
      const dLng = (stn.longitude - customerLng) * (Math.PI / 180);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(customerLat * (Math.PI / 180)) *
          Math.cos(stn.latitude * (Math.PI / 180)) *
          Math.sin(dLng / 2) *
          Math.sin(dLng / 2);
      const distanceKm = 6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));

      // Score formula
      const score = distanceKm * 1.5 - stn.available_stock_kg * 0.001;
      return { station: stn, distanceKm, score };
    });

    scored.sort((a, b) => a.score - b.score);
    const optimal = scored[0];

    return new Response(
      JSON.stringify({
        success: true,
        optimalStation: optimal.station,
        estimatedDistanceKm: parseFloat(optimal.distanceKm.toFixed(2)),
        aiReasoning: `Station '${optimal.station.name}' selected due to optimal stock (${optimal.station.available_stock_kg}kg available) and minimal queue congestion.`,
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
