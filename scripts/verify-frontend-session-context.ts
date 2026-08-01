import { createClient } from "npm:@supabase/supabase-js@2.110.9";

import { resolveSupabaseRuntime } from "./supabase-runtime.ts";

const runtime = await resolveSupabaseRuntime({ anonKey: true });
const supabaseUrl = runtime.supabaseUrl;
const anonKey = runtime.anonKey!;
const adminEmail = Deno.env.get("SKIMA_SUPER_ADMIN_EMAIL") ?? Deno.env.get("SKIMA_ADMIN_EMAIL");
const adminPassword = Deno.env.get("SKIMA_SUPER_ADMIN_PASSWORD") ??
  Deno.env.get("SKIMA_ADMIN_PASSWORD");

if (!adminEmail || !adminPassword) {
  throw new Error(
    "Set SKIMA_SUPER_ADMIN_EMAIL and SKIMA_SUPER_ADMIN_PASSWORD in the deployment shell, .env.local, or CI secret store.",
  );
}

const signInClient = createClient(supabaseUrl, anonKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

const { data: signInData, error: signInError } = await signInClient.auth.signInWithPassword({
  email: adminEmail,
  password: adminPassword,
});

if (signInError) {
  throw new Error(`Unable to sign in as the platform admin: ${signInError.message}`);
}

if (!signInData.session?.access_token) {
  throw new Error("Supabase Auth did not return an admin access token.");
}

const adminClient = createClient(supabaseUrl, anonKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
  global: {
    headers: {
      Authorization: `Bearer ${signInData.session.access_token}`,
    },
  },
});

const { data, error } = await adminClient.functions.invoke("api-gateway/runtime/session-context", {
  method: "GET",
});

if (error) {
  throw error;
}

const envelope = data as Readonly<Record<string, unknown>>;
const sessionContext = envelope.data as Readonly<Record<string, unknown>> | undefined;
const permissions = sessionContext?.permissions;
const roles = sessionContext?.roles;
const user = sessionContext?.user as Readonly<Record<string, unknown>> | undefined;

requireCondition(envelope.ok === true, "session context did not return ok=true.");
requireCondition(Boolean(user?.id), "session context did not include the authenticated user.");
requireCondition(
  Array.isArray(permissions) && permissions.length > 0,
  "session context did not include backend-driven permissions.",
);
requireCondition(
  Array.isArray(roles) && roles.length > 0,
  "session context did not include backend-driven roles.",
);

console.log("Frontend session-context remote smoke gate completed.");

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
