// SKIMA EDGE FUNCTION: AI AGENT 3 — MERCHANT PRODUCT ASSISTANT
// Path: supabase/functions/ai-merchant-assistant/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { rawTitle } = await req.json();

    if (!rawTitle) {
      return new Response(JSON.stringify({ error: "Missing rawTitle" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanTitle = rawTitle.trim();
    const professionalTitle = `Premium ${cleanTitle} - Certified Safety Grade`;
    const formattedDescription = `High-grade ${cleanTitle} verified for Skima Marketplace. Built for durability, safety compliance, and maximum operational efficiency in Awka.`;
    const category = cleanTitle.toLowerCase().includes("gas") ? "LPG Equipment & Accessories" : "General Hardware & Tools";

    return new Response(
      JSON.stringify({
        success: true,
        originalInput: rawTitle,
        professionalTitle,
        formattedDescription,
        category,
        keywords: [cleanTitle, "LPG Accessories", "Skima Verified", "Awka Commerce"],
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
