import { createClient } from "npm:@supabase/supabase-js@2.110.9";
import postgres from "npm:postgres@3.4.7";

import { loadLocalDeploymentEnv, resolveSupabaseRuntime } from "./supabase-runtime.ts";

const PRESERVED_PUBLIC_TABLES = new Set([
  "ai_task_definitions",
  "application_type_definitions",
  "business_module_components",
  "business_module_events",
  "business_module_versions",
  "business_modules",
  "capability_definitions",
  "catalog_units",
  "commission_policies",
  "configuration_entries",
  "currency_definitions",
  "dispatch_policies",
  "document_requirement_sets",
  "document_requirements",
  "event_handlers",
  "event_types",
  "lpg_cylinder_type_profiles",
  "lpg_operation_policies",
  "lpg_order_action_definitions",
  "lpg_safety_incident_type_definitions",
  "lpg_safety_severity_definitions",
  "lpg_station_role_presets",
  "notification_templates",
  "order_acceptance_policies",
  "order_action_definitions",
  "organizations",
  "permissions",
  "platform_admin_role_templates",
  "pricing_policies",
  "profiles",
  "provider_adapters",
  "rate_limit_policies",
  "reference_namespaces",
  "reference_sequences",
  "role_permissions",
  "roles",
  "settlement_policies",
  "vehicle_types",
  "verification_definitions",
  "workflow_definitions",
  "workflow_states",
  "workflow_transitions",
  "workflow_versions",
]);

await loadLocalDeploymentEnv();

if (Deno.env.get("SKIMA_ALLOW_REMOTE_DATA_PURGE") !== "true") {
  throw new Error("SKIMA_ALLOW_REMOTE_DATA_PURGE=true is required for this destructive operation.");
}

const targetEmail = requireEnv("SKIMA_BOOTSTRAP_EMAIL").trim().toLowerCase();
const stationName = Deno.env.get("SKIMA_BOOTSTRAP_STATION_NAME")?.trim() || "Skima Gas Station";
const driverName = Deno.env.get("SKIMA_BOOTSTRAP_DRIVER_NAME")?.trim() || "Skima Drivers";
const dbPassword = requireEnv("SUPABASE_DB_PASSWORD");
const runtime = await resolveSupabaseRuntime({ serviceRoleKey: true });
const poolerUrl = (await Deno.readTextFile("supabase/.temp/pooler-url")).trim();
const adminClient = createClient(runtime.supabaseUrl, runtime.serviceRoleKey!, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});

const removedStorageObjects = await clearStorageObjects();
const sql = postgres(poolerUrl, {
  password: dbPassword,
  ssl: "require",
  max: 1,
  prepare: false,
  connect_timeout: 20,
});

try {
  const [targetUser] = await sql`
    select id
    from auth.users
    where lower(email) = ${targetEmail}
    limit 1
  `;

  if (!targetUser?.id) {
    throw new Error(`The bootstrap Auth user does not exist: ${targetEmail}`);
  }

  const result = await sql.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext('skima.remote.application-data-purge'))`;

    const publicTables = await transaction`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
      order by table_name
    `;
    const clearedTables = publicTables
      .map((row) => String(row.table_name))
      .filter((tableName) => !PRESERVED_PUBLIC_TABLES.has(tableName));
    const truncateList = clearedTables
      .map((tableName) => `public."${tableName.replaceAll('"', '""')}"`)
      .join(", ");

    await transaction.unsafe(`truncate table ${truncateList} restart identity`);
    await transaction`delete from public.organizations`;
    await transaction`delete from public.profiles`;
    await transaction`delete from auth.users where id <> ${targetUser.id}`;
    await transaction`delete from auth.sessions`;
    await transaction`delete from auth.refresh_tokens`;
    await transaction`
      update auth.users
      set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) ||
        jsonb_build_object('display_name', ${driverName}::text, 'source', 'skima.bootstrap')
      where id = ${targetUser.id}
    `;

    await transaction`
      insert into public.profiles (id, display_name, status, metadata)
      values (
        ${targetUser.id},
        ${driverName},
        'active',
        jsonb_build_object('source', 'skima.bootstrap', 'station_name', ${stationName}::text)
      )
    `;
    await transaction`
      select set_config('request.jwt.claim.sub', ${targetUser.id}::text, true)
    `;
    await transaction`
      select set_config('request.jwt.claim.role', 'service_role', true)
    `;

    const [organization] = await transaction`
      insert into public.organizations (
        slug,
        legal_name,
        display_name,
        status,
        metadata,
        created_by
      )
      values (
        'skima-gas-station',
        ${stationName},
        ${stationName},
        'active',
        jsonb_build_object(
          'bounded_context', 'lpg',
          'bootstrap', true,
          'physical_location_status', 'awaiting_device_detection'
        ),
        ${targetUser.id}
      )
      returning id
    `;
    const organizationId = organization.id;

    await transaction`
      insert into public.organization_memberships (
        organization_id,
        user_id,
        membership_type,
        status,
        metadata,
        created_by
      )
      values (
        ${organizationId},
        ${targetUser.id},
        'owner',
        'active',
        jsonb_build_object('source', 'skima.bootstrap'),
        ${targetUser.id}
      )
    `;

    const businessOwnerRoleId = await ensureRole(transaction, {
      organizationId,
      key: "business.owner",
      displayName: "Business Owner",
      description: "Organization owner role configured by the bootstrap workflow.",
      createdBy: targetUser.id,
      permissionKeys: [
        "business.applications.manage",
        "business.documents.manage",
        "business.staff.manage",
        "business.catalog.manage",
        "business.orders.manage",
        "business.finance.read",
        "business.settlements.read",
      ],
    });

    const [stationPreset] = await transaction`
      select display_name, permission_keys
      from public.lpg_station_role_presets
      where key = 'lpg.station.owner'
        and status = 'active'
      limit 1
    `;
    if (!stationPreset) {
      throw new Error("The active lpg.station.owner role preset is missing.");
    }

    const stationRoleId = await ensureRole(transaction, {
      organizationId,
      key: "lpg.station.owner",
      displayName: String(stationPreset.display_name),
      description: "Station owner role configured from the LPG role preset.",
      createdBy: targetUser.id,
      permissionKeys: stationPreset.permission_keys as string[],
    });
    const driverRoleId = await ensureRole(transaction, {
      organizationId: null,
      key: "lpg.driver",
      displayName: "LPG Driver",
      description: "Approved LPG driver workspace role.",
      createdBy: targetUser.id,
      permissionKeys: ["lpg.config.read", "lpg.cylinders.read", "lpg.orders.read"],
    });

    await transaction`
      insert into public.user_roles (organization_id, user_id, role_id, status, created_by)
      values
        (${organizationId}, ${targetUser.id}, ${businessOwnerRoleId}, 'active', ${targetUser.id}),
        (${organizationId}, ${targetUser.id}, ${stationRoleId}, 'active', ${targetUser.id}),
        (null, ${targetUser.id}, ${driverRoleId}, 'active', ${targetUser.id})
    `;

    const [partner] = await transaction`
      insert into public.partner_profiles (
        organization_id,
        partner_type_key,
        status,
        behavior_config,
        metadata,
        created_by
      )
      values (
        ${organizationId},
        'application.lpg.station.phase-one',
        'active',
        jsonb_build_object('bounded_context', 'lpg'),
        jsonb_build_object('source', 'skima.bootstrap'),
        ${targetUser.id}
      )
      returning id
    `;
    await transaction`
      insert into public.entity_capabilities (
        entity_type,
        entity_id,
        capability_key,
        constraints,
        status,
        verified_at,
        created_by
      )
      values (
        'partner',
        ${partner.id},
        'capability.partner.refill-fulfillment',
        jsonb_build_object('source', 'skima.bootstrap'),
        'active',
        timezone('utc', now()),
        ${targetUser.id}
      )
    `;

    const [driver] = await transaction`
      insert into public.driver_profiles (
        user_id,
        operational_status,
        verification_status,
        identity_profile,
        service_profile,
        metadata,
        approved_at,
        created_by
      )
      values (
        ${targetUser.id},
        'offline',
        'approved',
        jsonb_build_object('display_name', ${driverName}::text),
        jsonb_build_object('workspace_name', ${driverName}::text),
        jsonb_build_object('source', 'skima.bootstrap'),
        timezone('utc', now()),
        ${targetUser.id}
      )
      returning id
    `;
    await transaction`
      insert into public.entity_capabilities (
        entity_type,
        entity_id,
        capability_key,
        constraints,
        status,
        verified_at,
        created_by
      )
      values (
        'driver',
        ${driver.id},
        'capability.driver.cylinder-handling',
        jsonb_build_object('source', 'skima.bootstrap'),
        'active',
        timezone('utc', now()),
        ${targetUser.id}
      )
    `;

    const [customerWallet] = await transaction`
      select public.ensure_wallet_account(
        'customer', 'user', ${targetUser.id}, 'NGN', 'skima.bootstrap',
        jsonb_build_object('workspace', 'customer'), 'bootstrap:customer-wallet'
      ) as id
    `;
    const [driverWallet] = await transaction`
      select public.ensure_wallet_account(
        'driver', 'driver', ${driver.id}, 'NGN', 'skima.bootstrap',
        jsonb_build_object('workspace', 'driver'), 'bootstrap:driver-wallet'
      ) as id
    `;
    const [stationWallet] = await transaction`
      select public.ensure_wallet_account(
        'partner', 'partner', ${partner.id}, 'NGN', 'skima.bootstrap',
        jsonb_build_object('workspace', 'station'), 'bootstrap:station-wallet'
      ) as id
    `;

    return {
      clearedTables: clearedTables.length,
      targetUserId: String(targetUser.id),
      organizationId: String(organizationId),
      partnerId: String(partner.id),
      driverProfileId: String(driver.id),
      walletIds: [customerWallet.id, driverWallet.id, stationWallet.id].map(String),
    };
  });

  console.log(JSON.stringify({
    projectRef: runtime.projectRef,
    targetEmail,
    stationName,
    driverName,
    removedStorageObjects,
    ...result,
  }, null, 2));
} finally {
  await sql.end();
}

async function ensureRole(
  transaction: postgres.TransactionSql,
  input: {
    organizationId: string | null;
    key: string;
    displayName: string;
    description: string;
    createdBy: string;
    permissionKeys: string[];
  },
): Promise<string> {
  await transaction`
    insert into public.roles (
      organization_id,
      key,
      display_name,
      description,
      status,
      metadata,
      created_by
    )
    values (
      ${input.organizationId},
      ${input.key},
      ${input.displayName},
      ${input.description},
      'active',
      jsonb_build_object('source', 'skima.bootstrap'),
      ${input.createdBy}
    )
    on conflict do nothing
  `;
  const [role] = await transaction`
    select id
    from public.roles
    where organization_id is not distinct from ${input.organizationId}
      and key = ${input.key}
    limit 1
  `;
  if (!role?.id) {
    throw new Error(`Unable to configure role ${input.key}.`);
  }
  await transaction`
    insert into public.role_permissions (role_id, permission_id)
    select ${role.id}, permission.id
    from public.permissions permission
    where permission.key in ${transaction(input.permissionKeys)}
    on conflict (role_id, permission_id) do nothing
  `;
  return String(role.id);
}

async function clearStorageObjects(): Promise<number> {
  const bucketsResult = await adminClient.storage.listBuckets();
  if (bucketsResult.error) throw bucketsResult.error;

  let removed = 0;
  for (const bucket of bucketsResult.data) {
    const paths = await listStoragePaths(bucket.id, "");
    for (let offset = 0; offset < paths.length; offset += 100) {
      const batch = paths.slice(offset, offset + 100);
      if (batch.length === 0) continue;
      const result = await adminClient.storage.from(bucket.id).remove(batch);
      if (result.error) throw result.error;
      removed += batch.length;
    }
  }
  return removed;
}

async function listStoragePaths(
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];
  let offset = 0;
  while (true) {
    const result = await adminClient.storage.from(bucket).list(prefix, {
      limit: 100,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (result.error) throw result.error;
    for (const entry of result.data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) paths.push(path);
      else paths.push(...await listStoragePaths(bucket, path));
    }
    if (result.data.length < 100) break;
    offset += 100;
  }
  return paths;
}

function requireEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`${key} is required.`);
  return value;
}
