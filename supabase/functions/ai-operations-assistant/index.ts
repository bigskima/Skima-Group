// SKIMA EDGE FUNCTION: AI AGENT 5 & 9 — OPERATIONS & EXECUTIVE ANALYTICS QUERY ASSISTANT
// Path: supabase/functions/ai-operations-assistant/index.ts

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
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { naturalQuery } = await req.json();

    if (!naturalQuery) {
      return new Response(JSON.stringify({ error: "Missing naturalQuery parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const queryLower = naturalQuery.toLowerCase();
    let targetTable = "gas_orders";
    let summaryText = "";
    let data: any[] = [];

    if (queryLower.includes("failed") || queryLower.includes("deposit")) {
      targetTable = "ledger_entries";
      const { data: ledger } = await supabaseAdmin
        .from("ledger_entries")
        .select("*")
        .eq("transaction_type", "DEPOSIT")
        .eq("status", "FAILED")
        .limit(10);
      
      data = ledger || [];
      summaryText = `Found ${data.length} failed wallet deposit transactions in system logs.`;
    } else if (queryLower.includes("station") || queryLower.includes("stock")) {
      targetTable = "lpg_stations";
      const { data: stations } = await supabaseAdmin
        .from("lpg_stations")
        .select("*")
        .eq("is_active", true)
        .order("available_stock_kg", { ascending: false });
      
      data = stations || [];
      summaryText = `Retrieved ${data.length} active LPG stations ranked by stock availability in Awka.`;
    } else {
      const { data: orders } = await supabaseAdmin
        .from("gas_orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      
      data = orders || [];
      summaryText = `Retrieved top ${data.length} recent gas orders telemetry.`;
    }

    return new Response(
      JSON.stringify({
        success: true,
        naturalQuery,
        targetTable,
        summaryText,
        data,
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
