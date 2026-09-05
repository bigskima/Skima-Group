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

async function readMigrationBySuffix(suffix: string): Promise<string> {
  const migrationDirectory = new URL("supabase/migrations/", ROOT);
  const matchingNames: string[] = [];

  for await (const entry of Deno.readDir(migrationDirectory)) {
    if (entry.isFile && entry.name.endsWith(suffix)) {
      matchingNames.push(entry.name);
    }
  }

  matchingNames.sort();
  const migrationName = matchingNames.at(-1);
  return migrationName ? await read(`supabase/migrations/${migrationName}`) : "";
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

function sqlFunctionSection(source: string, functionName: string): string {
  const escapedFunctionName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const definition = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${escapedFunctionName}\\s*\\(`,
    "i",
  ).exec(source);

  if (!definition) {
    return "";
  }

  const bodyMarker = /\bas\s+(\$[A-Za-z0-9_]*\$)/gi;
  bodyMarker.lastIndex = definition.index + definition[0].length;
  const openingMarker = bodyMarker.exec(source);
  if (!openingMarker) {
    return "";
  }

  const delimiter = openingMarker[1];
  const bodyStart = openingMarker.index + openingMarker[0].length;
  const bodyEnd = source.indexOf(delimiter, bodyStart);
  if (bodyEnd < 0) {
    return "";
  }

  return source.slice(definition.index, bodyEnd + delimiter.length + 1);
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

const [
  migrations,
  correctiveMigration,
  treasuryPayoutMigration,
  gateway,
  financeRuntime,
  paystackPayoutAdapter,
  adminConfig,
  adminRevenue,
  mobileWithdrawal,
  withdrawalModal,
] = await Promise.all([
  readMigrations(),
  readMigrationBySuffix("_lpg_revenue_station_permission_security_repair.sql"),
  readMigrationBySuffix("_platform_revenue_treasury_payout_runtime.sql"),
  read("supabase/functions/api-gateway/index.ts"),
  read("supabase/functions/finance-runtime/index.ts"),
  read("supabase/functions/_shared/paystack-payouts.ts"),
  read("apps/admin/src/admin-resource-config.ts"),
  read("apps/admin/src/admin-revenue-workspace.tsx"),
  read("apps/lpg-mobile/src/native/ui/FinanceWithdrawalExperience.tsx"),
  read("apps/lpg-mobile/src/native/ui/WithdrawalModal.tsx"),
]);

const correctedStationCatalogHelper = sqlFunctionSection(
  correctiveMigration,
  "ensure_lpg_station_refill_catalog_item",
);
const correctedRevenueConfiguration = sqlFunctionSection(
  correctiveMigration,
  "configure_lpg_platform_revenue_rate",
);
const rolePermissionRepairs = correctiveMigration
  .split(";")
  .filter((statement) => /insert\s+into\s+public\.role_permissions/i.test(statement))
  .join(";\n");
const stationCatalogHelperRevocations = correctiveMigration
  .split(";")
  .filter((statement) =>
    /\brevoke\b/i.test(statement) &&
    /on\s+function\s+public\.ensure_lpg_station_refill_catalog_item\s*\(\s*uuid\s*\)/i.test(
      statement,
    )
  )
  .join(";\n");

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
      /business\.partner_price\.manage/i,
      /can_manage_delegated_lpg_station_price/i,
      /target_item_id must be an LPG catalog item owned by the delegated station branch/i,
      /station users may set only their LPG selling price/i,
    ],
  },
  {
    name: "corrective migration synchronizes live Super Admin permissions",
    source: rolePermissionRepairs,
    required: [
      /insert\s+into\s+public\.role_permissions/i,
      /platform\.super_admin/i,
      /cross\s+join\s+public\.permissions/i,
      /on\s+conflict[\s\S]*do\s+nothing/i,
    ],
  },
  {
    name: "corrective migration repairs live Finance Admin revenue permissions",
    source: rolePermissionRepairs,
    required: [
      /insert\s+into\s+public\.role_permissions/i,
      /platform\.finance_admin/i,
      /platform\.revenue\.read/i,
      /platform\.revenue\.manage/i,
      /on\s+conflict[\s\S]*do\s+nothing/i,
    ],
  },
  {
    name: "corrective migration repairs live station price permission assignments",
    source: rolePermissionRepairs,
    required: [
      /insert\s+into\s+public\.role_permissions/i,
      /platform\.partner_price\.manage/i,
      /business\.partner_price\.manage/i,
      /on\s+conflict[\s\S]*do\s+nothing/i,
    ],
  },
  {
    name: "station catalog helper removes the unsafe definer-role bypass",
    source: correctedStationCatalogHelper,
    required: [
      /auth\.role\(\)\s*(?:<>|!=)\s*'service_role'/i,
      /public\.can_manage_lpg_operations\(\)/i,
      /public\.can_operate_lpg_station_branch\(/i,
    ],
    forbidden: [/\bcurrent_user\b/i],
  },
  {
    name: "station catalog helper cannot be executed directly by API roles",
    source: stationCatalogHelperRevocations,
    required: [
      /revoke\s+(?:all|execute)/i,
      /\bfrom\b[^;]*\bpublic\b/i,
      /\bfrom\b[^;]*\banon\b/i,
      /\bfrom\b[^;]*\bauthenticated\b/i,
    ],
  },
  {
    name: "duplicate LPG station catalog provisioning trigger is removed",
    source: correctiveMigration,
    required: [
      /drop\s+trigger\s+if\s+exists\s+(?:ensure_lpg_station_refill_catalog_item_after_write|provision_lpg_station_catalog_after_approval)\s+on\s+public\.lpg_station_branches/i,
    ],
  },
  {
    name: "approval-required LPG revenue configuration stops after submission",
    source: correctedRevenueConfiguration,
    required: [
      /target_approval_required\s*=>\s*true/i,
      /public\.submit_financial_policy_version\s*\(/i,
    ],
    forbidden: [
      /public\.review_financial_policy_version\s*\(/i,
      /public\.activate_financial_policy_version\s*\(/i,
      /update\s+public\.financial_policy_versions/i,
      /approved_by\s*=\s*auth\.uid\(\)/i,
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
    name: "Paystack transfer references are lowercase provider-safe identifiers",
    source: paystackPayoutAdapter,
    required: [
      /normalizePaystackTransferReference/i,
      /toLowerCase\(\)/i,
      /\[\^a-z0-9_-\]/i,
      /normalized\.length < 16 \|\| normalized\.length > 50/i,
    ],
  },
  {
    name: "wallet and treasury transfers do not reuse uppercase public references",
    source: financeRuntime + "\n" + gateway,
    required: [
      /skima-wdl-/i,
      /replaceAll\("-", ""\)/i,
    ],
    forbidden: [
      /const reference = withdrawal\.data\.public_reference \?\?/i,
      /const transferReference = String\(withdrawalRecord\.public_reference/i,
    ],
  },
  {
    name: "Paystack payout adapter resolves account holder server-side",
    source: paystackPayoutAdapter,
    required: [
      /api\.paystack\.co\/bank\/resolve/i,
      /account_number/i,
      /bank_code/i,
      /account_name/i,
      /api\.paystack\.co\/transferrecipient/i,
      /api\.paystack\.co\/transfer/i,
      /api\.paystack\.co\/balance/i,
    ],
  },
  {
    name: "mobile payout account name is provider resolved",
    source: financeRuntime,
    required: [
      /resolvePaystackBankAccount\(secret, accountNumber, bankCode\)/i,
      /accountNameSource:\s*"paystack\.bank\.resolve"/i,
      /createPaystackTransferRecipient\(secret, resolved\)/i,
    ],
    forbidden: [
      /const accountName\s*=\s*requireString\(body\.accountName/i,
    ],
  },
  {
    name: "mobile payout UI has no manual account-name input",
    source: mobileWithdrawal,
    required: [
      /\/beneficiaries\/resolve/i,
      /resolvedAccountName/i,
      /ACCOUNT CONFIRMED/i,
    ],
    forbidden: [
      /label="Account holder name"/i,
      /placeholder="Full account name"/i,
    ],
  },
  {
    name: "Paystack hard payout failures restore wallet funds",
    source: financeRuntime,
    required: [
      /error instanceof PaystackPayoutError/i,
      /target_provider_status:\s*"failed"/i,
      /process_wallet_withdrawal_transfer/i,
      /principalAttempted:\s*withdrawal\.data\.amount/i,
      /providerStatus:\s*"failed"/i,
    ],
  },
  {
    name: "ambiguous wallet payouts expose safe retry without duplicate processing",
    source: financeRuntime,
    required: [
      /path === "\/withdrawals\/retry"/i,
      /owned\.data\.status === "processing" \|\| owned\.data\.status === "succeeded"/i,
      /owned\.data\.status !== "approved"/i,
      /retryable:\s*true/i,
    ],
  },
  {
    name: "withdrawal UI explains reservation and failure reversal accurately",
    source: withdrawalModal,
    required: [
      /Retry bank transfer/i,
      /reserved amount is restored automatically/i,
      /Ready to retry/i,
      /Failed · funds restored/i,
    ],
    forbidden: [
      /You will be charged only after the transfer succeeds/i,
    ],
  },
  {
    name: "Super Admin revenue payout retries are guarded against duplicate transfers",
    source: gateway,
    required: [
      /\/admin\/revenue\/payout\/retry/i,
      /withdrawal\.data\.source !== "platform\.revenue_payout"/i,
      /withdrawal\.data\.status === "succeeded" \|\| withdrawal\.data\.status === "processing"/i,
      /withdrawal\.data\.status !== "approved"/i,
    ],
  },
  {
    name: "Admin exposes retry for approved revenue payouts",
    source: adminRevenue,
    required: [
      /\/admin\/revenue\/payout\/retry/i,
      /payout\.status === "approved"/i,
      /Retry transfer/i,
    ],
  },
  {
    name: "gateway Paystack transfers send principal only",
    source: gateway,
    required: [
      /amountMajor:\s*Number\(withdrawalRecord\.amount\)/i,
      /principalSentToProvider:\s*withdrawalRecord\.amount/i,
      /skimaFeeRetained:\s*withdrawalRecord\.fee_amount/i,
    ],
    forbidden: [
      /amount:\s*Math\.round\(Number\(withdrawalRecord\.total_debit_amount\)\s*\*\s*100\)/i,
    ],
  },
  {
    name: "platform revenue payout remains Super Admin treasury-only",
    source: treasuryPayoutMigration,
    required: [
      /create or replace function public\.request_platform_revenue_withdrawal/i,
      /public\.is_platform_super_admin\(\)/i,
      /wallet_type\s*=\s*'platform_revenue'/i,
      /owner_entity_type\s*=\s*'platform'/i,
      /'platform\.revenue_payout'/i,
      /fee_amount[\s\S]*0/i,
    ],
  },
  {
    name: "treasury withdrawals do not reduce earned revenue reporting",
    source: treasuryPayoutMigration,
    required: [
      /earned_entries/i,
      /treasury_entries/i,
      /withdrawal_source\s*=\s*'platform\.revenue_payout'/i,
      /'treasuryNetOutflow'/i,
      /'activityKind'/i,
      /'treasury_payout'/i,
    ],
  },
  {
    name: "Admin exposes provider balance and protected revenue withdrawal",
    source: adminRevenue,
    required: [
      /Paystack transfer balance/i,
      /Withdraw SKIMA Revenue/i,
      /\/admin\/revenue\/payout-account\/resolve/i,
      /\/admin\/revenue\/payout/i,
      /Treasury outflow/i,
    ],
  },
  {
    name: "fee editor captures React input value before deferred state update",
    source: adminRevenue,
    required: [
      /const nextValue = event\.currentTarget\.value;/i,
      /setFeeAmounts\(\(current\)\s*=>\s*\(\{\s*\.\.\.current,\s*\[fee\.key\]:\s*nextValue/i,
    ],
    forbidden: [
      /setFeeAmounts\(\(current\)\s*=>[\s\S]{0,120}event\.currentTarget\.value/i,
    ],
  },
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
