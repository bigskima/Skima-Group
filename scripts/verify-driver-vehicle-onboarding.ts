import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.9";

import { resolveSupabaseRuntime } from "./supabase-runtime.ts";

interface GateUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly accessToken: string;
  readonly client: SupabaseClient;
}

interface AdminSession {
  readonly accessToken: string;
  readonly client: SupabaseClient;
  readonly userId: string;
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

const adminAccessToken = Deno.env.get("SKIMA_ADMIN_ACCESS_TOKEN");
const adminEmail = Deno.env.get("SKIMA_SUPER_ADMIN_EMAIL") ?? Deno.env.get("SKIMA_ADMIN_EMAIL");
const adminPassword = Deno.env.get("SKIMA_SUPER_ADMIN_PASSWORD") ??
  Deno.env.get("SKIMA_ADMIN_PASSWORD");
const runId = crypto.randomUUID();
const runKey = runId.replaceAll("-", "").slice(0, 12);
const source = "platform.driver_vehicle_gate";
const driverCapabilityKey = `capability.gate.driver.${runKey}`;
const vehicleCapabilityKey = `capability.gate.vehicle.${runKey}`;
const dispatchPolicyKey = `dispatch.gate.driver-vehicle.${runKey}`;

console.log(`Running driver and vehicle onboarding gate ${runId}...`);

const adminSession = await resolveAdminSession();
const driverApplicant = await createGateUser("driver-applicant");
const directWriter = await createGateUser("direct-driver-writer");

await seedIsolatedDispatchConfiguration();
await requireDirectSelfApprovalRejected(directWriter);
await requireNoEligibleDispatchBeforeApproval();

const driverApplicationId = await createDriverApplication(driverApplicant);
const driverDocumentIds = await registerDocuments(
  driverApplicant.accessToken,
  driverApplicant.id,
  driverApplicationId,
  [
    "driver.identity",
    "driver.licence",
    "driver.address-evidence",
  ],
);
await submitAndApproveApplication(
  driverApplicant.accessToken,
  adminSession,
  driverApplicationId,
  driverDocumentIds,
  "driver",
);
const driverId = await requireActivatedDriver(driverApplicationId, driverApplicant);

await requireDriverCanBecomeAvailable(driverApplicant.client, driverId);

const vehicleApplicationId = await createVehicleApplication(driverApplicant, driverId);
const vehicleDocumentIds = await registerDocuments(
  driverApplicant.accessToken,
  driverApplicant.id,
  vehicleApplicationId,
  [
    "vehicle.registration",
    "vehicle.ownership-authorization",
    "vehicle.insurance",
  ],
);
await submitAndApproveApplication(
  driverApplicant.accessToken,
  adminSession,
  vehicleApplicationId,
  vehicleDocumentIds,
  "vehicle",
);
const vehicleId = await requireActivatedVehicle(vehicleApplicationId, driverApplicant, driverId);

await requireRuntimeReadEndpoints(driverApplicant.accessToken, driverId, vehicleId);
await requireEligibleDispatchAfterApproval(driverId, vehicleId);
await requireAuditEvidence(driverApplicationId, vehicleApplicationId, driverId, vehicleId);

console.log("Driver and vehicle onboarding gate completed.");
console.log(`driver_application_id=${driverApplicationId}`);
console.log(`vehicle_application_id=${vehicleApplicationId}`);
console.log(`driver_id=${driverId}`);
console.log(`vehicle_id=${vehicleId}`);

async function seedIsolatedDispatchConfiguration(): Promise<void> {
  await requireMutation(
    serviceClient.from("capability_definitions").upsert([
      {
        category: "driver.gate",
        description: "Driver capability isolated to the onboarding gate.",
        key: driverCapabilityKey,
        schema: { gate: "driver_vehicle_onboarding", runId },
        status: "active",
      },
      {
        category: "vehicle.gate",
        description: "Vehicle capability isolated to the onboarding gate.",
        key: vehicleCapabilityKey,
        schema: { gate: "driver_vehicle_onboarding", runId },
        status: "active",
      },
    ], { onConflict: "key" }),
    "seed isolated capability definitions",
  );

  await requireMutation(
    serviceClient.from("dispatch_policies").upsert({
      display_name: `Driver Vehicle Gate ${runKey}`,
      key: dispatchPolicyKey,
      matching_strategy: "capability_distance",
      rules: {
        driver_required_capabilities: [driverCapabilityKey],
        vehicle_authorization_required: true,
        vehicle_required_capabilities: [vehicleCapabilityKey],
      },
      status: "active",
    }, { onConflict: "key" }),
    "seed isolated dispatch policy",
  );
}

async function requireDirectSelfApprovalRejected(user: GateUser): Promise<void> {
  const driverAttempt = await user.client.from("driver_profiles").insert({
    metadata: { gate: "driver_vehicle_onboarding", runId },
    operational_status: "available",
    user_id: user.id,
    verification_status: "approved",
  });

  requireCondition(Boolean(driverAttempt.error), "direct self-approved driver insert was allowed.");

  const vehicleType = await requireSingle(
    serviceClient.from("vehicle_types").select("id").eq("key", "vehicle.motorcycle").single(),
    "read vehicle type",
  );

  const vehicleAttempt = await user.client.from("vehicles").insert({
    capacity_profile: { gate: "driver_vehicle_onboarding", runId },
    owner_user_id: user.id,
    status: "active",
    vehicle_type_id: vehicleType.id,
  });

  requireCondition(Boolean(vehicleAttempt.error), "direct self-active vehicle insert was allowed.");
}

async function requireNoEligibleDispatchBeforeApproval(): Promise<void> {
  const serviceRequestId = await createServiceRequest("preapproval");
  const { error } = await serviceClient.rpc("dispatch_service_request", {
    target_candidate_limit: 5,
    target_dispatch_policy_key: dispatchPolicyKey,
    target_idempotency_key: idempotency("preapproval-dispatch"),
    target_service_request_id: serviceRequestId,
  });

  requireCondition(Boolean(error), "dispatch found a driver before approval.");
  requireCondition(
    String(error?.message ?? "").includes("no eligible dispatch candidates found"),
    `preapproval dispatch returned unexpected error: ${String(error?.message)}`,
  );
}

async function createDriverApplication(driver: GateUser): Promise<string> {
  return await postGatewayId(driver.accessToken, "/runtime/applications", {
    applicationTypeKey: "application.driver.default",
    idempotencyKey: idempotency("create-driver-application"),
    metadata: { gate: "driver_vehicle_onboarding", runId },
    payload: {
      capabilityKeys: [driverCapabilityKey],
      contact: {
        email: driver.email,
        phone: "+2348000000001",
      },
      identity: {
        displayName: "Driver Vehicle Gate Driver",
        fullName: "Driver Vehicle Gate Driver",
      },
      licence: {
        class: "configured",
        expiresAt: "2027-07-28",
        number: `DRV-${runKey}`,
      },
      serviceProfile: {
        availabilityPolicy: "driver-controlled-after-approval",
      },
      workingHours: {
        monday: ["08:00", "18:00"],
      },
      zones: ["gate-zone"],
    },
    source,
  });
}

async function createVehicleApplication(driver: GateUser, driverId: string): Promise<string> {
  return await postGatewayId(driver.accessToken, "/runtime/applications", {
    applicationTypeKey: "application.vehicle.default",
    idempotencyKey: idempotency("create-vehicle-application"),
    metadata: { gate: "driver_vehicle_onboarding", runId },
    payload: {
      vehicle: {
        capabilityKeys: [vehicleCapabilityKey],
        capacityProfile: {
          max_units: 2,
        },
        cargoVolumeM3: 1.2,
        color: "black",
        driverProfileId: driverId,
        fuelType: "petrol",
        inspectionExpiresAt: "2027-07-28",
        insuranceExpiresAt: "2027-07-28",
        manufacturer: "Honda",
        maxLoadKg: 75,
        model: "Configured Motorcycle",
        ownershipType: "driver_owned",
        passengerCapacity: 1,
        registrationNumber: `SK-${runKey.toUpperCase()}`,
        roadworthinessExpiresAt: "2027-07-28",
        vehicleTypeKey: "vehicle.motorcycle",
        year: 2026,
      },
    },
    source,
  });
}

async function registerDocuments(
  accessToken: string,
  ownerUserId: string,
  applicationId: string,
  requirementKeys: readonly string[],
): Promise<string[]> {
  const documentIds: string[] = [];

  for (const requirementKey of requirementKeys) {
    documentIds.push(
      await postGatewayId(accessToken, "/runtime/documents", {
        applicationId,
        byteSize: 2048,
        checksum: `${runId}:${requirementKey}`,
        contentType: "application/pdf",
        idempotencyKey: idempotency(`document-${applicationId}-${requirementKey}`),
        metadata: { gate: "driver_vehicle_onboarding", requirementKey, runId },
        requirementKey,
        source,
        storageBucket: "skima-platform-documents",
        storagePath: `${ownerUserId}/${runId}/${applicationId}/${requirementKey}.pdf`,
      }),
    );
  }

  return documentIds;
}

async function submitAndApproveApplication(
  applicantAccessToken: string,
  admin: AdminSession,
  applicationId: string,
  documentIds: readonly string[],
  label: string,
): Promise<void> {
  await postGatewayId(applicantAccessToken, "/runtime/applications/submit", {
    applicationId,
    idempotencyKey: idempotency(`submit-${label}`),
    metadata: { gate: "driver_vehicle_onboarding", label, runId },
  });
  await requireApplicationStatus(applicationId, "submitted");

  await postGatewayId(admin.accessToken, "/runtime/applications/reviewer", {
    applicationId,
    idempotencyKey: idempotency(`assign-reviewer-${label}`),
    metadata: { gate: "driver_vehicle_onboarding", label, runId },
    reviewerUserId: admin.userId,
  });
  await requireApplicationStatus(applicationId, "under_review");

  for (const documentSubmissionId of documentIds) {
    await postGatewayId(admin.accessToken, "/runtime/documents/review", {
      applicantMessage: "Document accepted.",
      decision: "approved",
      documentSubmissionId,
      idempotencyKey: idempotency(`approve-${label}-document-${documentSubmissionId}`),
      internalNotes: "Driver vehicle onboarding gate document approval.",
      metadata: { gate: "driver_vehicle_onboarding", label, runId },
    });
  }

  await postGatewayId(admin.accessToken, "/runtime/applications/decisions", {
    applicationId,
    decision: "approved",
    idempotencyKey: idempotency(`approve-${label}-application`),
    metadata: { gate: "driver_vehicle_onboarding", label, runId },
    reason: "All configured driver or vehicle requirements were satisfied.",
  });
  await requireApplicationStatus(applicationId, "approved");
}

async function requireActivatedDriver(
  applicationId: string,
  driver: GateUser,
): Promise<string> {
  const application = await requireSingle(
    serviceClient
      .from("application_records")
      .select("activated_subject_type,activated_subject_id")
      .eq("id", applicationId)
      .single(),
    "read activated driver application",
  );

  requireCondition(
    application.activated_subject_type === "driver",
    `driver application activated ${String(application.activated_subject_type)}.`,
  );

  const driverId = requireStringValue(application.activated_subject_id, "driver id");
  const driverRecord = await requireSingle(
    serviceClient
      .from("driver_profiles")
      .select(
        "id,user_id,operational_status,verification_status,identity_profile,license_profile,approved_at",
      )
      .eq("id", driverId)
      .single(),
    "read activated driver profile",
  );

  requireCondition(driverRecord.user_id === driver.id, "driver profile owner is incorrect.");
  requireCondition(driverRecord.verification_status === "approved", "driver was not approved.");
  requireCondition(driverRecord.operational_status === "offline", "driver should start offline.");
  requireCondition(
    typeof driverRecord.approved_at === "string",
    "driver approved_at timestamp was not recorded.",
  );

  await requireCapability("driver", driverId, driverCapabilityKey);

  return driverId;
}

async function requireDriverCanBecomeAvailable(
  client: SupabaseClient,
  driverId: string,
): Promise<void> {
  await requireMutation(
    client
      .from("driver_profiles")
      .update({ operational_status: "available" })
      .eq("id", driverId),
    "driver set available",
  );

  const driver = await requireSingle(
    serviceClient
      .from("driver_profiles")
      .select("operational_status")
      .eq("id", driverId)
      .single(),
    "read available driver",
  );

  requireCondition(driver.operational_status === "available", "driver did not become available.");
}

async function requireActivatedVehicle(
  applicationId: string,
  driver: GateUser,
  driverId: string,
): Promise<string> {
  const application = await requireSingle(
    serviceClient
      .from("application_records")
      .select("activated_subject_type,activated_subject_id")
      .eq("id", applicationId)
      .single(),
    "read activated vehicle application",
  );

  requireCondition(
    application.activated_subject_type === "vehicle",
    `vehicle application activated ${String(application.activated_subject_type)}.`,
  );

  const vehicleId = requireStringValue(application.activated_subject_id, "vehicle id");
  const vehicle = await requireSingle(
    serviceClient
      .from("vehicles")
      .select(
        "id,owner_user_id,status,ownership_type,manufacturer,model,model_year,registration_number,max_load_kg,vehicle_type_id",
      )
      .eq("id", vehicleId)
      .single(),
    "read activated vehicle",
  );

  requireCondition(vehicle.owner_user_id === driver.id, "vehicle owner is incorrect.");
  requireCondition(vehicle.status === "active", "vehicle was not activated.");
  requireCondition(
    vehicle.ownership_type === "driver_owned",
    "vehicle ownership type was not set.",
  );
  requireCondition(vehicle.manufacturer === "Honda", "vehicle manufacturer was not hydrated.");
  requireCondition(vehicle.model_year === 2026, "vehicle year was not hydrated.");
  await requireCapability("vehicle", vehicleId, vehicleCapabilityKey);

  const link = await requireSingle(
    serviceClient
      .from("driver_vehicle_links")
      .select("id,status,relationship_type")
      .eq("driver_profile_id", driverId)
      .eq("vehicle_id", vehicleId)
      .eq("status", "active")
      .single(),
    "read active driver vehicle link",
  );

  requireCondition(
    link.relationship_type === "driver_owned",
    "driver vehicle link is not driver-owned.",
  );

  return vehicleId;
}

async function requireRuntimeReadEndpoints(
  accessToken: string,
  driverId: string,
  vehicleId: string,
): Promise<void> {
  const drivers = await getGatewayData(accessToken, "/runtime/drivers");
  requireCondition(
    drivers.some((record) => record.id === driverId),
    "runtime driver endpoint did not return the applicant driver.",
  );

  const vehicles = await getGatewayData(accessToken, "/runtime/vehicles");
  requireCondition(
    vehicles.some((record) => record.id === vehicleId),
    "runtime vehicle endpoint did not return the applicant vehicle.",
  );

  const links = await getGatewayData(accessToken, "/runtime/driver-vehicle-links");
  requireCondition(
    links.some((record) =>
      record.driver_profile_id === driverId && record.vehicle_id === vehicleId
    ),
    "runtime driver vehicle link endpoint did not return the active link.",
  );
}

async function requireEligibleDispatchAfterApproval(
  driverId: string,
  vehicleId: string,
): Promise<void> {
  const serviceRequestId = await createServiceRequest("postapproval");
  const firstDispatchId = await requireRpcId(
    serviceClient.rpc("dispatch_service_request", {
      target_candidate_limit: 5,
      target_dispatch_policy_key: dispatchPolicyKey,
      target_idempotency_key: idempotency("postapproval-dispatch"),
      target_service_request_id: serviceRequestId,
    }),
    "dispatch after driver and vehicle approval",
  );

  const duplicateDispatchId = await requireRpcId(
    serviceClient.rpc("dispatch_service_request", {
      target_candidate_limit: 5,
      target_dispatch_policy_key: dispatchPolicyKey,
      target_idempotency_key: idempotency("postapproval-dispatch"),
      target_service_request_id: serviceRequestId,
    }),
    "dispatch idempotency replay",
  );

  requireCondition(
    firstDispatchId === duplicateDispatchId,
    "dispatch idempotency returned a new request.",
  );

  const candidate = await requireSingle(
    serviceClient
      .from("dispatch_candidates")
      .select("candidate_entity_id,status,rationale")
      .eq("dispatch_request_id", firstDispatchId)
      .eq("candidate_entity_type", "driver")
      .order("rank", { ascending: true })
      .limit(1)
      .single(),
    "read dispatch candidate",
  );

  requireCondition(
    candidate.candidate_entity_id === driverId,
    "dispatch selected the wrong driver.",
  );
  requireCondition(candidate.status === "offered", "top dispatch candidate was not offered.");

  const rationale = requireRecordValue(candidate.rationale, "dispatch rationale");
  requireCondition(
    rationale.vehicle_id === vehicleId,
    "dispatch did not attach the approved vehicle.",
  );
}

async function createServiceRequest(label: string): Promise<string> {
  return await requireRpcId(
    serviceClient.rpc("create_module_service_request", {
      target_idempotency_key: idempotency(`service-request-${label}`),
      target_metadata: { gate: "driver_vehicle_onboarding", label, runId },
      target_module_key: "lpg",
      target_organization_id: null,
      target_request_payload: {
        dropoff_location: { latitude: 6.2458, longitude: 7.1191 },
        pickup_location: { latitude: 6.2448, longitude: 7.1181 },
        priority: 10,
      },
      target_source: source,
    }),
    `create ${label} service request`,
  );
}

async function requireAuditEvidence(
  driverApplicationId: string,
  vehicleApplicationId: string,
  driverId: string,
  vehicleId: string,
): Promise<void> {
  await requireAuditRecord("application_records", driverApplicationId);
  await requireAuditRecord("application_records", vehicleApplicationId);
  await requireAuditRecord("driver_profiles", driverId);
  await requireAuditRecord("vehicles", vehicleId);

  const { data, error } = await serviceClient
    .from("audit_logs")
    .select("id")
    .eq("entity_type", "driver_vehicle_links")
    .contains("after_state", { driver_profile_id: driverId, vehicle_id: vehicleId })
    .limit(1);

  if (error) {
    throw error;
  }

  requireCondition((data ?? []).length > 0, "driver vehicle link audit evidence is missing.");
}

async function requireCapability(
  entityType: string,
  entityId: string,
  capabilityKey: string,
): Promise<void> {
  const capability = await requireSingle(
    serviceClient
      .from("entity_capabilities")
      .select("id,status,verified_at")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .eq("capability_key", capabilityKey)
      .eq("status", "active")
      .single(),
    `read ${entityType} capability ${capabilityKey}`,
  );

  requireCondition(
    typeof capability.verified_at === "string",
    `${entityType} capability was not verified.`,
  );
}

async function createGateUser(kind: string): Promise<GateUser> {
  const email = `skima-${kind}-${runId}@example.invalid`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: {
      gate: "driver_vehicle_onboarding",
      kind,
      runId,
    },
  });

  if (error) {
    throw error;
  }

  if (!data.user?.id) {
    throw new Error(`Supabase Auth did not create ${kind} user.`);
  }

  await requireMutation(
    serviceClient.from("profiles").upsert({
      display_name: `Driver Vehicle Gate ${kind}`,
      id: data.user.id,
      metadata: { gate: "driver_vehicle_onboarding", runId },
      status: "active",
    }),
    `upsert ${kind} profile`,
  );

  const client = createBrowserSafeClient();
  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    throw signInError;
  }

  if (!signInData.session?.access_token) {
    throw new Error(`Supabase Auth did not return an access token for ${kind}.`);
  }

  return {
    accessToken: signInData.session.access_token,
    client: createAuthenticatedClient(signInData.session.access_token),
    email,
    id: data.user.id,
    password,
  };
}

async function postGatewayId(
  accessToken: string,
  path: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const body = await postGateway(accessToken, path, payload);
  const id = body.id;

  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`${path} did not return an id.`);
  }

  return id;
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
  const body = await readGatewayJson(response);

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

async function getGatewayData(
  accessToken: string,
  path: string,
): Promise<ReadonlyArray<Record<string, unknown>>> {
  const response = await fetch(`${supabaseUrl}/functions/v1/api-gateway${path}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    method: "GET",
  });
  const body = await readGatewayJson(response);

  if (!response.ok) {
    throw new Error(
      `${path} returned HTTP ${response.status}: ${String(body.message ?? body.error)}`,
    );
  }

  if (!Array.isArray(body.data)) {
    throw new Error(`${path} did not return a data array.`);
  }

  return body.data as ReadonlyArray<Record<string, unknown>>;
}

async function readGatewayJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json();

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Gateway response was not a JSON object.");
  }

  return value as Record<string, unknown>;
}

async function resolveAdminSession(): Promise<AdminSession> {
  if (adminAccessToken) {
    const client = createAuthenticatedClient(adminAccessToken);
    const userId = await requireCurrentUserId(client, "platform admin");

    return { accessToken: adminAccessToken, client, userId };
  }

  if (!adminEmail || !adminPassword) {
    throw new Error(
      "Set SKIMA_ADMIN_ACCESS_TOKEN or SKIMA_SUPER_ADMIN_EMAIL and SKIMA_SUPER_ADMIN_PASSWORD in the deployment shell, .env.local, or CI secret store.",
    );
  }

  const signInClient = createBrowserSafeClient();
  const { data, error } = await signInClient.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  });

  if (error) {
    throw new Error(`Unable to sign in as the platform admin: ${error.message}`);
  }

  if (!data.session?.access_token) {
    throw new Error("Supabase Auth did not return an admin access token.");
  }

  const client = createAuthenticatedClient(data.session.access_token);
  const userId = await requireCurrentUserId(client, "platform admin");

  return { accessToken: data.session.access_token, client, userId };
}

async function requireCurrentUserId(client: SupabaseClient, label: string): Promise<string> {
  const { data, error } = await client.auth.getUser();

  if (error) {
    throw error;
  }

  if (!data.user?.id) {
    throw new Error(`${label} did not resolve to a Supabase Auth user.`);
  }

  return data.user.id;
}

function createBrowserSafeClient(): SupabaseClient {
  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function createAuthenticatedClient(accessToken: string): SupabaseClient {
  return createClient(supabaseUrl, anonKey, {
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
  });
}

async function requireApplicationStatus(applicationId: string, status: string): Promise<void> {
  const application = await requireSingle(
    serviceClient
      .from("application_records")
      .select("status")
      .eq("id", applicationId)
      .single(),
    "read application status",
  );

  requireCondition(
    application.status === status,
    `application expected status ${status}, found ${String(application.status)}.`,
  );
}

async function requireAuditRecord(entityType: string, entityId: string): Promise<void> {
  const { data, error } = await serviceClient
    .from("audit_logs")
    .select("id")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .limit(1);

  if (error) {
    throw error;
  }

  requireCondition((data ?? []).length > 0, `${entityType} audit evidence is missing.`);
}

async function requireRpcId(
  resultPromise: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  operationName: string,
): Promise<string> {
  const { data, error } = await resultPromise;

  if (error) {
    throw new Error(`${operationName} failed: ${error.message}`);
  }

  if (typeof data !== "string" || data.length === 0) {
    throw new Error(`${operationName} did not return an id.`);
  }

  return data;
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

async function requireMutation(
  resultPromise: PromiseLike<{ error: { message: string } | null }>,
  operationName: string,
): Promise<void> {
  const { error } = await resultPromise;

  if (error) {
    throw new Error(`${operationName} failed: ${error.message}`);
  }
}

function idempotency(step: string): string {
  return `${source}:${runId}:${step}`;
}

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function requireStringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireRecordValue(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  return value as Readonly<Record<string, unknown>>;
}
