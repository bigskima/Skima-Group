import { createClient } from "npm:@supabase/supabase-js@2.110.9";

import { resolveSupabaseRuntime } from "./supabase-runtime.ts";

const PLATFORM_WALLET_TYPES = ["platform", "escrow", "commission", "refund"] as const;

const runtime = await resolveSupabaseRuntime({ serviceRoleKey: true });
const serviceClient = createClient(runtime.supabaseUrl, runtime.serviceRoleKey!, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

for (const walletType of PLATFORM_WALLET_TYPES) {
  const { data, error } = await serviceClient.rpc("ensure_wallet_account", {
    target_currency_code: "NGN",
    target_idempotency_key: `platform-wallet:${walletType}:NGN`,
    target_metadata: {
      foundation_wallet: true,
      phase_one_currency: "NGN",
      wallet_purpose: walletType,
    },
    target_owner_entity_id: null,
    target_owner_entity_type: "platform",
    target_source: "platform.wallet_bootstrap",
    target_wallet_type: walletType,
  });

  if (error) {
    throw new Error(`Unable to provision ${walletType} wallet. ${error.message}`);
  }

  console.log(`Provisioned ${walletType} NGN wallet ${data}.`);
}

console.log("Platform wallet provisioning completed.");
