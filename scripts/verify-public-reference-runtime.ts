import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.9";

import { resolveSupabaseRuntime } from "./supabase-runtime.ts";

interface GateUser {
  readonly accessToken: string;
  readonly client: SupabaseClient;
  readonly email: string;
  readonly id: string;
}

const runtime = await resolveSupabaseRuntime({ anonKey: true, serviceRoleKey: true });
const supabaseUrl = runtime.supabaseUrl;
const anonKey = runtime.anonKey!;
const serviceRoleKey = runtime.serviceRoleKey!;
const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

const runId = crypto.randomUUID();
const runKey = runId.replaceAll("-", "").slice(0, 12);
const source = "platform.public_reference_gate";

console.log(`Running public reference runtime gate ${runId}...`);

const customer = await createGateUser("reference-customer");

await requireReferenceNamespaces();
await requireAuthenticatedReferenceGenerationRejected(customer);

const cylinderId = await createDirectCylinder(customer);
const cylinderReference = await requireSubjectReference(
  "lpg_cylinders",
  cylinderId,
  /^CYL-\d{8,20}$/,
);
await requireSubjectReferenceUpdateRejected(customer, "lpg_cylinders", cylinderId, cylinderReference);
await requirePublicReferenceReceiptIsProtected(customer, cylinderReference);

const depositCreateBody = await postGateway(customer.accessToken, "/runtime/payments/deposits", {
  amount: 2500,
  currencyCode: "NGN",
  idempotencyKey: idempotency("deposit"),
  metadata: { gate: "public_reference_runtime", runId },
  source,
});
const depositId = requireStringValue(depositCreateBody.id, "deposit id");
const depositPublicReference = requireStringValue(
  depositCreateBody.publicReference,
  "deposit public reference",
);
requireCondition(
  /^PAY-\d{8,20}$/.test(depositPublicReference),
  `deposit public reference had an unexpected format: ${depositPublicReference}`,
);

const depositRetryBody = await postGateway(customer.accessToken, "/runtime/payments/deposits", {
  amount: 2500,
  currencyCode: "NGN",
  idempotencyKey: idempotency("deposit"),
  metadata: { gate: "public_reference_runtime", retry: true, runId },
  source,
});
requireCondition(
  depositRetryBody.id === depositId,
  "idempotent deposit retry returned a different internal id.",
);
requireCondition(
  depositRetryBody.publicReference === depositPublicReference,
  "idempotent deposit retry returned a different public reference.",
);
await requireSubjectReference("payment_deposit_requests", depositId, /^PAY-\d{8,20}$/);

console.log("Public reference runtime gate completed.");
console.log(`cylinder_id=${cylinderId}`);
console.log(`cylinder_public_reference=${cylinderReference}`);
console.log(`deposit_request_id=${depositId}`);
console.log(`deposit_public_reference=${depositPublicReference}`);

async function createGateUser(kind: string): Promise<GateUser> {
  const email = `skima-${kind}-${runId}@example.invalid`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { gate: "public_reference_runtime", kind, runId },
  });

  if (error) {
    throw error;
  }

  if (!data.user?.id) {
    throw new Error(`Supabase Auth did not create ${kind} user.`);
  }

  await requireMutation(
    serviceClient.from("profiles").upsert({
      display_name: `Reference Gate ${kind}`,
      id: data.user.id,
      metadata: { gate: "public_reference_runtime", runId },
      status: "active",
    }),
    `upsert ${kind} profile`,
  );

  const browserClient = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const signIn = await browserClient.auth.signInWithPassword({ email, password });

  if (signIn.error) {
    throw signIn.error;
  }

  const accessToken = signIn.data.session?.access_token;

  if (!accessToken) {
    throw new Error(`Supabase Auth did not return an access token for ${kind}.`);
  }

  return {
    accessToken,
    client: createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    }),
    email,
    id: data.user.id,
  };
}

async function requireReferenceNamespaces(): Promise<void> {
  const records = await requireMany(
    serviceClient
      .from("reference_namespaces")
      .select("key,prefix,subject_type,status")
      .in("key", [
        "reference.lpg.cylinder",
        "reference.lpg.order",
        "reference.lpg.scan-session",
        "reference.payment.deposit",
        "reference.withdrawal.request",
        "reference.commission.execution",
        "reference.settlement.statement",
      ]),
    "read reference namespaces",
  );
  const byKey = new Map(records.map((record) => [requireStringValue(record.key, "key"), record]));

  for (
    const [key, prefix, subjectType] of [
      ["reference.lpg.cylinder", "CYL", "lpg.cylinder"],
      ["reference.lpg.order", "SKM", "lpg.order"],
      ["reference.lpg.scan-session", "SCN", "lpg.scan-session"],
      ["reference.payment.deposit", "PAY", "payment.deposit"],
      ["reference.withdrawal.request", "WDL", "withdrawal.request"],
      ["reference.commission.execution", "COM", "commission.execution"],
      ["reference.settlement.statement", "STL", "settlement.statement"],
    ] as const
  ) {
    const record = byKey.get(key);

    if (!record) {
      throw new Error(`Reference namespace is missing: ${key}.`);
    }

    requireCondition(record.prefix === prefix, `${key} prefix was not ${prefix}.`);
    requireCondition(record.subject_type === subjectType, `${key} subject type was incorrect.`);
    requireCondition(record.status === "active", `${key} was not active.`);
  }
}

async function requireAuthenticatedReferenceGenerationRejected(user: GateUser): Promise<void> {
  const result = await user.client.rpc("generate_public_reference", {
    target_idempotency_key: idempotency("direct-generation"),
    target_metadata: { gate: "public_reference_runtime", runId },
    target_namespace_key: "reference.lpg.order",
    target_source: source,
    target_subject_id: crypto.randomUUID(),
    target_subject_type: "lpg.order",
  });

  requireCondition(Boolean(result.error), "authenticated direct public reference generation was allowed.");
}

async function createDirectCylinder(user: GateUser): Promise<string> {
  const record = await requireSingle(
    user.client
      .from("lpg_cylinders")
      .insert({
        condition_status: "good",
        cylinder_identifier: `reference-gate-${runKey}`,
        idempotency_key: idempotency("direct-cylinder"),
        max_capacity_kg: 12.5,
        metadata: { gate: "public_reference_runtime", runId },
        public_reference: "CYL-CLIENTSUPPLIED",
        size_kg: 12.5,
        source,
      })
      .select("id")
      .single(),
    "insert direct LPG cylinder",
  );

  return requireStringValue(record.id, "cylinder id");
}

async function requireSubjectReference(
  tableName: string,
  recordId: string,
  pattern: RegExp,
): Promise<string> {
  const record = await requireSingle(
    serviceClient
      .from(tableName)
      .select("public_reference")
      .eq("id", recordId)
      .single(),
    `read ${tableName} public reference`,
  );
  const publicReference = requireStringValue(record.public_reference, `${tableName} public reference`);

  requireCondition(
    pattern.test(publicReference),
    `${tableName} public reference had an unexpected format: ${publicReference}`,
  );

  return publicReference;
}

async function requireSubjectReferenceUpdateRejected(
  user: GateUser,
  tableName: string,
  recordId: string,
  currentReference: string,
): Promise<void> {
  const updateResult = await user.client
    .from(tableName)
    .update({ public_reference: `${currentReference}-EDIT` })
    .eq("id", recordId);

  requireCondition(Boolean(updateResult.error), `${tableName} public reference update was allowed.`);
}

async function requirePublicReferenceReceiptIsProtected(
  user: GateUser,
  publicReference: string,
): Promise<void> {
  const readResult = await user.client
    .from("public_references")
    .select("reference")
    .eq("reference", publicReference);

  if (readResult.error) {
    throw readResult.error;
  }

  requireCondition(
    Array.isArray(readResult.data) && readResult.data.length === 0,
    "public reference receipt was exposed to an unprivileged user.",
  );

  const insertResult = await user.client
    .from("public_references")
    .insert({
      idempotency_key: idempotency("direct-receipt-insert"),
      namespace_id: crypto.randomUUID(),
      reference: `SKM-${runKey.toUpperCase()}`,
      source,
      subject_id: crypto.randomUUID(),
      subject_type: "lpg.order",
    });

  requireCondition(Boolean(insertResult.error), "public reference receipt direct insert was allowed.");
}

async function postGateway(
  accessToken: string,
  path: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${supabaseUrl}/functions/v1/api-gateway${path}`, {
    body: JSON.stringify(payload),
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(
      `${path} returned HTTP ${response.status}: ${String(body.message ?? body.error)}`,
    );
  }

  if (body.ok !== true) {
    throw new Error(`${path} did not return ok=true.`);
  }

  return body;
}

async function requireSingle<T extends Record<string, unknown>>(
  resultPromise: PromiseLike<{ data: T | null; error: { message: string } | null }>,
  operationName: string,
): Promise<T> {
  const { data, error } = await resultPromise;

  if (error) {
    throw new Error(`${operationName} failed: ${error.message}`);
  }

  if (!data) {
    throw new Error(`${operationName} returned no record.`);
  }

  return data;
}

async function requireMany<T extends Record<string, unknown>>(
  resultPromise: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  operationName: string,
): Promise<T[]> {
  const { data, error } = await resultPromise;

  if (error) {
    throw new Error(`${operationName} failed: ${error.message}`);
  }

  return Array.isArray(data) ? data : [];
}

async function requireMutation(
  resultPromise: PromiseLike<{ error: { message: string } | null }>,
  operationName: string,
): Promise<void> {
  const { error } = await resultPromise;

  if (error) {
    throw new Error(`${operationName} failed: ${error.message}`);
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json();

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object response.");
  }

  return value as Record<string, unknown>;
}

function idempotency(step: string): string {
  return `${source}:${runId}:${step}`;
}

function requireStringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
