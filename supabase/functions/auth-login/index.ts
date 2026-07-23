// SKIMA EDGE FUNCTION: AUTHENTICATION LOGIN & ROLE METADATA RESOLVER
// Path: supabase/functions/auth-login/index.ts

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
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const { email, password } = await req.json();

    if (!email || !password) {
      return new Response(JSON.stringify({ error: "Email and password are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Authenticate with Supabase Auth
    const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.session) {
      return new Response(JSON.stringify({ error: authError?.message || "Invalid credentials" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch User Profile & Permissions
    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("*")
      .eq("id", authData.user.id)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "Profile record not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Resolve Available Roles for Dynamic Unlocking
    const availableRoles: string[] = ["CUSTOMER"];
    if (profile.is_driver) availableRoles.push("DRIVER");
    if (profile.is_station_admin) availableRoles.push("STATION_ADMIN");
    if (profile.is_pump_attendant) availableRoles.push("PUMP_ATTENDANT");
    if (profile.is_merchant) availableRoles.push("MERCHANT");
    if (profile.is_admin) availableRoles.push("ADMIN");

    return new Response(
      JSON.stringify({
        success: true,
        session: authData.session,
        user: authData.user,
        profile,
        availableRoles,
        activeRole: "CUSTOMER", // Default role upon login
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
