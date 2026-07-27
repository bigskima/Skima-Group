import { createClient } from "npm:@supabase/supabase-js@2.110.9";

import { resolveSupabaseRuntime } from "./supabase-runtime.ts";

const runtime = await resolveSupabaseRuntime({ serviceRoleKey: true });
const adminUserId = requireFirstEnv(["SKIMA_SUPER_ADMIN_USER_ID", "SKIMA_BOOTSTRAP_ADMIN_USER_ID"]);

const supabase = createClient(runtime.supabaseUrl, runtime.serviceRoleKey!);
const { error } = await supabase.rpc("bootstrap_platform_super_admin", {
  target_user_id: adminUserId,
});

if (error) {
  throw error;
}

console.log(`Bootstrapped platform super admin role for user ${adminUserId}.`);

function requireFirstEnv(keys: readonly string[]): string {
  for (const key of keys) {
    const value = Deno.env.get(key);

    if (value) {
      return value;
    }
  }

  throw new Error(`${keys.join(" or ")} is required in the deployment shell or CI secret store.`);
}
