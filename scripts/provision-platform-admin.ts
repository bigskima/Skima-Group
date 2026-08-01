import { createClient, type User } from "npm:@supabase/supabase-js@2.110.9";

import { resolveSupabaseRuntime } from "./supabase-runtime.ts";

const runtime = await resolveSupabaseRuntime({ serviceRoleKey: true });
const adminEmail = requireFirstEnv(["SKIMA_SUPER_ADMIN_EMAIL", "SKIMA_ADMIN_EMAIL"]);
const adminPassword = Deno.env.get("SKIMA_SUPER_ADMIN_PASSWORD") ??
  Deno.env.get("SKIMA_ADMIN_PASSWORD");
const adminDisplayName = Deno.env.get("SKIMA_SUPER_ADMIN_DISPLAY_NAME") ??
  Deno.env.get("SKIMA_ADMIN_DISPLAY_NAME");
const inviteRedirectTo = Deno.env.get("SKIMA_SUPER_ADMIN_INVITE_REDIRECT_URL");

const supabase = createClient(runtime.supabaseUrl, runtime.serviceRoleKey!, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

const adminUser = await getOrCreateAdminUser();

const { error: bootstrapError } = await supabase.rpc("bootstrap_platform_super_admin", {
  target_user_id: adminUser.id,
});

if (bootstrapError) {
  throw bootstrapError;
}

console.log(`Provisioned platform super admin user ${adminUser.id}.`);

async function getOrCreateAdminUser(): Promise<User> {
  const existingUser = await findUserByEmail(adminEmail);

  if (existingUser) {
    return await updateExistingAdminUser(existingUser);
  }

  const { data, error } = adminPassword
    ? await supabase.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: adminMetadata(),
    })
    : await supabase.auth.admin.inviteUserByEmail(adminEmail, {
      data: adminMetadata(),
      redirectTo: inviteRedirectTo,
    });

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error("Supabase Auth did not return the created admin user.");
  }

  return data.user;
}

async function updateExistingAdminUser(existingUser: User): Promise<User> {
  const attributes = {
    ...(adminPassword ? { password: adminPassword, email_confirm: true } : {}),
    user_metadata: {
      ...existingUser.user_metadata,
      ...adminMetadata(),
    },
  };

  const { data, error } = await supabase.auth.admin.updateUserById(
    existingUser.id,
    attributes,
  );

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error("Supabase Auth did not return the updated admin user.");
  }

  return data.user;
}

function adminMetadata(): Record<string, string> {
  return {
    ...(adminDisplayName ? { display_name: adminDisplayName } : {}),
  };
}

async function findUserByEmail(email: string): Promise<User | null> {
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 100,
    });

    if (error) {
      throw error;
    }

    const user = data.users.find((candidate) =>
      candidate.email?.toLowerCase() === email.toLowerCase()
    );

    if (user) {
      return user;
    }

    if (data.users.length < 100) {
      return null;
    }

    page += 1;
  }
}

function requireFirstEnv(keys: readonly string[]): string {
  for (const key of keys) {
    const value = Deno.env.get(key);

    if (value) {
      return value;
    }
  }

  throw new Error(
    `${keys.join(" or ")} is required in the deployment shell, .env.local, or CI secret store.`,
  );
}
