const ROOT = new URL("../", import.meta.url);

async function read(relativePath: string): Promise<string> {
  return await Deno.readTextFile(new URL(relativePath, ROOT));
}

async function readMigrations(): Promise<string> {
  const migrationDirectory = new URL("supabase/migrations/", ROOT);
  const migrationNames: string[] = [];

  for await (const entry of Deno.readDir(migrationDirectory)) {
    if (entry.isFile && entry.name.endsWith(".sql")) {
      migrationNames.push(entry.name);
    }
  }

  migrationNames.sort();
  return (await Promise.all(
    migrationNames.map(async (name) =>
      `\n-- ${name}\n${await read(`supabase/migrations/${name}`)}`
    ),
  )).join("\n");
}

type Check = {
  name: string;
  source: string;
  allowMissing?: boolean;
  required?: RegExp[];
  forbidden?: RegExp[];
};

function routeSection(gateway: string, route: string): string {
  const marker = `if (routePath === "${route}"`;
  const start = gateway.indexOf(marker);
  if (start < 0) {
    return "";
  }

  const nextRoute = gateway.indexOf("\n  if (routePath", start + marker.length);
  return gateway.slice(start, nextRoute < 0 ? gateway.length : nextRoute);
}

function actionSection(adminConfig: string, actionKey: string): string {
  const marker = `"${actionKey}"`;
  const start = adminConfig.indexOf(marker);
  if (start < 0) {
    return "";
  }

  const nextAction = adminConfig.indexOf("\n        action(", start + marker.length);
  return adminConfig.slice(start, nextAction < 0 ? adminConfig.length : nextAction);
}

function literalPattern(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

function evaluate(check: Check): string[] {
  const failures: string[] = [];

  if (check.source.length === 0) {
    if (check.allowMissing) {
      return failures;
    }
    return [`${check.name}: expected source section is missing`];
  }

  for (const pattern of check.required ?? []) {
    if (!pattern.test(check.source)) {
      failures.push(`${check.name}: missing ${pattern}`);
    }
  }

  for (const pattern of check.forbidden ?? []) {
    if (pattern.test(check.source)) {
      failures.push(`${check.name}: forbidden ${pattern}`);
    }
  }

  return failures;
}

const [migrations, gateway, adminConfig] = await Promise.all([
  readMigrations(),
  read("supabase/functions/api-gateway/index.ts"),
  read("apps/admin/src/admin-resource-config.ts"),
]);

const withdrawalRoute = routeSection(gateway, "/runtime/withdrawals");
const commissionRoute = routeSection(gateway, "/runtime/commissions/execute");
const orderSettlementRoute = routeSection(gateway, "/runtime/order-settlements/execute");
const rawSettlementRoute = routeSection(gateway, "/runtime/settlements/execute");
const rawEscrowReleaseRoute = routeSection(gateway, "/runtime/escrow/release");
const adminLifecycleActions: Array<[string, string, string]> = [
  [
    "create-financial-policy-version",
    "/admin/financial-policies",
    "platform.financial_policy.draft",
  ],
  [
    "submit-financial-policy",
    "/admin/financial-policies/submit",
    "platform.financial_policy.draft",
  ],
  [
    "review-financial-policy",
    "/admin/financial-policies/review",
    "platform.financial_policy.approve",
  ],
  [
    "activate-financial-policy",
    "/admin/financial-policies/activate",
    "platform.financial_policy.activate",
  ],
  [
    "deactivate-financial-policy",
    "/admin/financial-policies/deactivate",
    "platform.financial_policy.activate",
  ],
  [
    "rollback-financial-policy",
    "/admin/financial-policies/rollback",
    "platform.financial_policy.rollback",
  ],
  [
    "preview-financial-policy",
    "/admin/financial-policies/resolve",
    "platform.financial_policy.read",
  ],
];

const checks: Check[] = [
  {
    name: "versioned policy schema and universal scope",
    source: migrations,
    required: [
      /create table if not exists public\.financial_policy_definitions/i,
      /create table if not exists public\.financial_policy_versions/i,
      /organization_id uuid/i,
      /module_id uuid/i,
      /service_key text/i,
      /geography_type text/i,
      /geography_key text/i,
      /currency_code text not null/i,
      /effective_from timestamptz not null/i,
      /effective_until timestamptz/i,
      /configuration jsonb not null/i,
    ],
  },
  {
    name: "RBAC and maker-checker approval boundary",
    source: migrations,
    required: [
      /platform\.financial_policy\.draft/i,
      /platform\.financial_policy\.approve/i,
      /platform\.financial_policy\.activate/i,
      /platform\.financial_policy\.rollback/i,
      /create or replace function public\.review_financial_policy_version/i,
      /before_record\.created_by\s*=\s*auth\.uid\(\)/i,
      /creators cannot approve or reject their own version/i,
      /only a submitted financial policy version can be reviewed/i,
    ],
  },
  {
    name: "lifecycle, effective dates, conflict prevention, and fail-closed resolution",
    source: migrations,
    required: [
      /create or replace function public\.submit_financial_policy_version/i,
      /create or replace function public\.activate_financial_policy_version/i,
      /create or replace function public\.deactivate_financial_policy_version/i,
      /create or replace function public\.assert_financial_policy_no_conflict/i,
      /perform public\.assert_financial_policy_no_conflict/i,
      /effective_from\s*<=\s*target_at/i,
      /effective_until is null or version\.effective_until\s*>\s*target_at/i,
      /no approved active financial policy version matches/i,
      /ambiguous active financial policy versions match/i,
    ],
  },
  {
    name: "append-only history, previous/new values, and audit",
    source: migrations,
    required: [
      /create table if not exists public\.financial_policy_events/i,
      /previous_state jsonb/i,
      /new_state jsonb/i,
      /financial policy events are append-only/i,
      /before update or delete on public\.financial_policy_versions/i,
      /financial policy version business fields are immutable/i,
      /audit_financial_policy_versions_mutations/i,
      /execute function public\.record_table_audit\(\)/i,
    ],
  },
  {
    name: "governed rollback creates a new version",
    source: migrations,
    required: [
      /create or replace function public\.rollback_financial_policy_version/i,
      /return public\.create_financial_policy_version\(/i,
      /rollback_restore_version_id/i,
      /rollback_of_version_id/i,
      /supersedes_version_id/i,
    ],
  },
  {
    name: "accepted LPG obligations retain immutable policy snapshots",
    source: migrations,
    required: [
      /alter table public\.lpg_refill_quotes[\s\S]*financial_policy_snapshot jsonb/i,
      /alter table public\.lpg_refill_orders[\s\S]*financial_policy_snapshot jsonb/i,
      /copy_lpg_quote_policy_snapshot_to_order/i,
      /accepted LPG order requires a locked financial policy snapshot/i,
      /prevent_lpg_quote_financial_snapshot_mutation/i,
      /prevent_lpg_order_financial_snapshot_mutation/i,
      /accepted LPG financial policy snapshot is immutable/i,
    ],
  },
  {
    name: "backend-authoritative LPG quote",
    source: migrations,
    required: [
      /create or replace function public\.calculate_lpg_commercial_quote/i,
      /public\.resolve_financial_policy\(/i,
      /exactly one configured LPG delivery distance band must match/i,
      /financial_policy_snapshot\s*=\s*commercial_snapshot\s*->\s*'policySnapshots'/i,
    ],
  },
  {
    name: "delegated station price boundary",
    source: migrations,
    required: [
      /platform\.partner_price\.manage/i,
      /can_manage_delegated_lpg_station_price/i,
      /target_item_id must be an LPG catalog item owned by the delegated station branch/i,
      /station users may set only their LPG selling price/i,
    ],
  },
  {
    name: "withdrawal fee is resolved by backend policy",
    source: withdrawalRoute,
    required: [
      /calculate_withdrawal_fee_from_policy/i,
      /target_fee_amount:\s*calculatedFeeAmount/i,
      /financialPolicySnapshot:\s*feeSnapshot/i,
    ],
    forbidden: [/payload\.feeAmount/i, /payload\[\s*["']feeAmount["']\s*\]/i],
  },
  {
    name: "driver commission is derived from the accepted order snapshot",
    source: commissionRoute,
    required: [/execute_driver_commission_from_order/i, /target_order_id/i],
    forbidden: [
      /payload\.(amount|baseAmount|commissionAmount|commissionPolicyKey|percentage|rate)/i,
      /target_(base_amount|commission_amount|commission_policy_key|percentage|rate)/i,
    ],
  },
  {
    name: "business settlement is derived from a locked snapshot",
    source: orderSettlementRoute,
    required: [/execute_order_business_settlement_from_snapshot/i, /target_order_id/i],
    forbidden: [
      /payload\.platformFeeAmount/i,
      /target_platform_fee_amount/i,
      /execute_order_business_settlement"\s*,/i,
    ],
  },
  {
    name: "raw settlement distribution is not client controlled",
    source: rawSettlementRoute,
    allowMissing: true,
    forbidden: [/payload\.distribution/i, /execute_service_request_settlement"\s*,/i],
  },
  {
    name: "raw escrow distribution is not client controlled",
    source: rawEscrowReleaseRoute,
    allowMissing: true,
    forbidden: [/payload\.distribution/i, /release_escrow_hold"\s*,/i],
  },
  ...adminLifecycleActions.map(([actionKey, route, permission]): Check => ({
    name: `admin ${actionKey} action`,
    source: actionSection(adminConfig, actionKey),
    required: [literalPattern(route), literalPattern(permission)],
  })),
  {
    name: "admin withdrawal does not submit a fee",
    source: actionSection(adminConfig, "request-withdrawal"),
    forbidden: [/feeAmount/i, /withdrawalFee/i],
  },
  {
    name: "admin commission does not submit authoritative money",
    source: actionSection(adminConfig, "execute-commission"),
    forbidden: [/baseAmount/i, /commissionAmount/i, /commissionPolicyKey/i, /percentage/i, /rate/i],
  },
  {
    name: "admin settlement does not submit a platform fee",
    source: actionSection(adminConfig, "execute-order-settlement"),
    forbidden: [/platformFeeAmount/i],
  },
];

const failures = checks.flatMap(evaluate);

if (failures.length > 0) {
  console.error("Financial policy governance verification failed:\n");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  Deno.exit(1);
}

console.log(`Financial policy governance verification passed (${checks.length} focused checks).`);
