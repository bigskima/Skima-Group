// SKIMA EDGE FUNCTION: AUTHENTICATION SIGNUP & PROFILE INITIALIZATION
// Path: supabase/functions/auth-signup/index.ts

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

    const { email, password, fullName, phoneNumber } = await req.json();

    if (!email || !password || !fullName || !phoneNumber) {
      return new Response(
        JSON.stringify({ error: "Email, password, fullName, and phoneNumber are required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Create Auth User in Supabase Auth
    const { data: authData, error: signUpError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      phone: phoneNumber,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        phone_number: phoneNumber,
      },
    });

    if (signUpError || !authData.user) {
      return new Response(JSON.stringify({ error: signUpError?.message || "User creation failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = authData.user.id;
    const publicId = `SKM-U-${Math.floor(100000 + Math.random() * 900000)}`;

    // 2. Insert Profile Record
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert({
        id: userId,
        public_id: publicId,
        full_name: fullName,
        phone_number: phoneNumber,
        email: email,
        is_driver: false,
        is_merchant: false,
        is_station_admin: false,
        is_pump_attendant: false,
        is_admin: false,
        status: "ACTIVE",
      })
      .select()
      .single();

    if (profileError) {
      throw new Error(`Profile creation error: ${profileError.message}`);
    }

    // 3. Ensure Primary Wallet exists
    await supabaseAdmin
      .from("wallets")
      .upsert({ user_id: userId, currency: "NGN", balance: 0.0, locked_balance: 0.0 }, { onConflict: "user_id" });

    return new Response(
      JSON.stringify({
        success: true,
        user: authData.user,
        profile,
        message: "Account created successfully. Primary wallet provisioned.",
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
