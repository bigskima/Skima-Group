import { createClient } from "npm:@supabase/supabase-js@2.110.9";

import { resolveSupabaseRuntime } from "./supabase-runtime.ts";

const runtime = await resolveSupabaseRuntime({ serviceRoleKey: true });

const supabase = createClient(runtime.supabaseUrl, runtime.serviceRoleKey!, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

const { data, error } = await supabase
  .from("platform_admin_role_templates")
  .select("key,display_name,status,permission_keys")
  .order("key", { ascending: true });

if (error) {
  throw error;
}

for (const role of data ?? []) {
  const permissionCount = Array.isArray(role.permission_keys) ? role.permission_keys.length : 0;
  console.log(`${role.key} | ${role.status} | ${permissionCount} permissions`);
}
