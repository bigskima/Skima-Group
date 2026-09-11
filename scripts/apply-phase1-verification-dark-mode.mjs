import { readFile, writeFile } from "node:fs/promises";

function replaceExact(source, before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Phase 1 patch could not find ${label}`);
  }
  return source.replace(before, after);
}

function replaceAllExact(source, before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Phase 1 patch could not find ${label}`);
  }
  return source.split(before).join(after);
}

async function patchPartnerVerification() {
  const path = "supabase/functions/_shared/partner-verification.ts";
  let source = await readFile(path, "utf8");

  source = replaceExact(
    source,
    `  const mapping = await applicationMapping(\n    serviceClient,\n    applicationTypeId,\n    verificationKey,\n  );\n\n  const appliesResult = await serviceClient.rpc(`,
    `  const mapping = await applicationMapping(\n    serviceClient,\n    applicationTypeId,\n    verificationKey,\n  );\n  const mappingMetadata = recordValue(mapping.metadata);\n  const providerAudience = textValue(\n    mappingMetadata.provider_audience ?? mappingMetadata.providerAudience,\n  );\n\n  const appliesResult = await serviceClient.rpc(`,
    "provider audience resolution",
  );

  source = replaceExact(
    source,
    `  const route = await activeRoute(serviceClient, verificationDefinitionId);\n  const manualFallbackAllowed = mapping.manual_fallback_allowed === true;\n\n  if (!route) {`,
    `  const route = await activeRoute(serviceClient, verificationDefinitionId);\n  const manualFallbackAllowed = mapping.manual_fallback_allowed === true;\n\n  if (!route) {`,
    "active verification route lookup",
  );

  source = replaceExact(
    source,
    `  if (route.provider.key !== "provider.verification.didit") {`,
    `  if (providerAudience && !routeAllowsAudience(route.config, providerAudience)) {\n    throw new VerificationRuntimeError(\n      "verification_audience_not_supported",\n      "This verification route is not enabled for the current applicant role.",\n      409,\n      { manualFallbackAllowed, providerAudience },\n    );\n  }\n\n  if (route.provider.key !== "provider.verification.didit") {`,
    "provider audience enforcement",
  );

  source = replaceExact(
    source,
    `      verification_key: verificationKey,\n      verification_scope: verificationKey === "verification.business.registry" ? "station_kyb" : "partner_kyc",\n    },`,
    `      verification_key: verificationKey,\n      verification_scope: verificationKey === "verification.business.registry" ? "station_kyb" : "partner_kyc",\n      ...(providerAudience ? { skima_partner_role: providerAudience } : {}),\n    },`,
    "provider audience metadata",
  );

  source = replaceExact(
    source,
    `  let providerBody: Record<string, unknown>;\n  try {\n    providerBody = await diditRequest(\n      apiKey,\n      "https://verification.didit.me/v3/session/",\n      {\n        method: "POST",\n        body: JSON.stringify(providerRequest),\n      },\n    );\n  } catch (error) {`,
    `  let providerBody: Record<string, unknown>;\n  let providerWorkflowRef = route.workflow_ref;\n  try {\n    const providerResult = await createDiditSessionWithWorkflowRecovery({\n      apiKey,\n      serviceClient,\n      route,\n      providerRequest,\n      verificationKey,\n      idempotencyKey,\n    });\n    providerBody = providerResult.body;\n    providerWorkflowRef = providerResult.workflowRef;\n  } catch (error) {`,
    "Didit session workflow recovery",
  );

  source = replaceAllExact(
    source,
    `        workflowRef: route.workflow_ref,`,
    `        workflowRef: providerWorkflowRef,`,
    "provider workflow logging",
  );

  source = replaceExact(
    source,
    `.select("id,verification_definition_id,manual_fallback_allowed")`,
    `.select("id,verification_definition_id,manual_fallback_allowed,metadata")`,
    "verification mapping metadata select",
  );

  const activeRouteMarker = `async function diditRequest(\n  apiKey: string,\n  url: string,\n  init: RequestInit,\n): Promise<Record<string, unknown>> {`;
  if (!source.includes(activeRouteMarker)) {
    throw new Error("Phase 1 patch could not find Didit request helper");
  }

  const workflowHelpers = `type ActiveVerificationRoute = {\n  id: string;\n  workflow_ref: string;\n  config: Record<string, unknown>;\n  provider: { id: string; key: string; display_name: string };\n};\n\nfunction routeAllowsAudience(\n  routeConfig: Record<string, unknown>,\n  audience: string,\n): boolean {\n  const configured = Array.isArray(routeConfig.audience)\n    ? routeConfig.audience.map(textValue).filter((value): value is string => Boolean(value))\n    : [];\n  if (configured.length === 0 || configured.includes(audience)) return true;\n\n  const aliasMap = recordValue(\n    routeConfig.providerAudienceAliases ?? routeConfig.provider_audience_aliases,\n  );\n  const directAliases = Array.isArray(aliasMap[audience])\n    ? (aliasMap[audience] as unknown[])\n        .map(textValue)\n        .filter((value): value is string => Boolean(value))\n    : [];\n  if (directAliases.some((alias) => configured.includes(alias))) return true;\n\n  return Object.entries(aliasMap).some(([configuredAlias, values]) => {\n    if (!configured.includes(configuredAlias) || !Array.isArray(values)) return false;\n    return values.some((value) => textValue(value) === audience);\n  });\n}\n\nasync function createDiditSessionWithWorkflowRecovery(input: {\n  apiKey: string;\n  serviceClient: SupabaseClient;\n  route: ActiveVerificationRoute;\n  providerRequest: Record<string, unknown>;\n  verificationKey: string;\n  idempotencyKey: string;\n}): Promise<{ body: Record<string, unknown>; workflowRef: string }> {\n  try {\n    return {\n      body: await diditRequest(\n        input.apiKey,\n        "https://verification.didit.me/v3/session/",\n        { method: "POST", body: JSON.stringify(input.providerRequest) },\n      ),\n      workflowRef: input.route.workflow_ref,\n    };\n  } catch (error) {\n    if (!shouldRecoverDiditWorkflow(error, input.route.config)) throw error;\n\n    const recovered = await resolveDiditWorkflow(input.apiKey, input.route.config);\n    if (!recovered) throw error;\n\n    const recoveredRequest = {\n      ...input.providerRequest,\n      workflow_id: recovered.uuid,\n    };\n    const body = await diditRequest(\n      input.apiKey,\n      "https://verification.didit.me/v3/session/",\n      { method: "POST", body: JSON.stringify(recoveredRequest) },\n    );\n\n    if (input.route.config.workflowRecoveryPersistResolvedRef === true) {\n      await persistRecoveredDiditWorkflow(\n        input.serviceClient,\n        input.route,\n        recovered,\n      );\n    }\n\n    await logProviderExecution(input.serviceClient, {\n      providerAdapterId: input.route.provider.id,\n      operationKey: "verification.workflow.recovered",\n      status: "succeeded",\n      idempotencyKey: `${input.idempotencyKey}:workflow-recovery`,\n      requestPayload: {\n        verificationKey: input.verificationKey,\n        previousWorkflowRef: input.route.workflow_ref,\n      },\n      responsePayload: {\n        workflowRef: recovered.uuid,\n        workflowLabel: recovered.label,\n        source: recovered.source,\n      },\n    });\n\n    return { body, workflowRef: recovered.uuid };\n  }\n}\n\nfunction shouldRecoverDiditWorkflow(\n  error: unknown,\n  routeConfig: Record<string, unknown>,\n): boolean {\n  if (routeConfig.workflowRecoveryEnabled !== true) return false;\n  if (!(error instanceof VerificationRuntimeError)) return false;\n  if (error.code !== "verification_provider_request_failed") return false;\n  if (error.details.providerHttpStatus !== 400) return false;\n\n  const message = textValue(error.details.providerMessage)?.toLowerCase() ?? "";\n  return (\n    message.includes("workflow") &&\n    (\n      message.includes("invalid") ||\n      message.includes("not found") ||\n      message.includes("does not exist") ||\n      message.includes("unknown")\n    )\n  );\n}\n\nasync function resolveDiditWorkflow(\n  apiKey: string,\n  routeConfig: Record<string, unknown>,\n): Promise<{ uuid: string; label: string; source: string } | null> {\n  const workflows = await listDiditWorkflows(apiKey);\n  const eligible = workflows.filter((workflow) => {\n    if (workflow.is_archived === true) return false;\n    const type = textValue(workflow.workflow_type)?.toLowerCase();\n    return !type || type === "kyc" || type === "user" || type === "identity";\n  });\n  if (eligible.length === 0) return null;\n\n  const configuredLabel = textValue(\n    routeConfig.workflow_label ?? routeConfig.workflowLabel,\n  );\n  if (routeConfig.workflowRecoveryPreferConfiguredLabel === true && configuredLabel) {\n    const labelMatch = eligible.find(\n      (workflow) => textValue(workflow.workflow_label)?.toLowerCase() === configuredLabel.toLowerCase(),\n    );\n    const uuid = textValue(labelMatch?.uuid);\n    if (labelMatch && uuid) {\n      return {\n        uuid,\n        label: textValue(labelMatch.workflow_label) ?? configuredLabel,\n        source: "configured_label",\n      };\n    }\n  }\n\n  if (routeConfig.freeTierEligible === true) {\n    const freeLabelMatch = eligible.find((workflow) =>\n      textValue(workflow.workflow_label)?.toLowerCase().includes("free")\n    );\n    const uuid = textValue(freeLabelMatch?.uuid);\n    if (freeLabelMatch && uuid) {\n      return {\n        uuid,\n        label: textValue(freeLabelMatch.workflow_label) ?? "Free KYC",\n        source: "free_label",\n      };\n    }\n  }\n\n  if (routeConfig.workflowRecoveryAllowDefaultKyc === true) {\n    const defaultWorkflow = eligible.find((workflow) => workflow.is_default === true);\n    const uuid = textValue(defaultWorkflow?.uuid);\n    if (defaultWorkflow && uuid) {\n      return {\n        uuid,\n        label: textValue(defaultWorkflow.workflow_label) ?? "Default KYC",\n        source: "default_kyc",\n      };\n    }\n  }\n\n  if (eligible.length === 1) {\n    const uuid = textValue(eligible[0].uuid);\n    if (uuid) {\n      return {\n        uuid,\n        label: textValue(eligible[0].workflow_label) ?? "KYC",\n        source: "only_eligible_kyc",\n      };\n    }\n  }\n\n  return null;\n}\n\nasync function listDiditWorkflows(\n  apiKey: string,\n): Promise<Record<string, unknown>[]> {\n  let response: Response;\n  try {\n    response = await fetch("https://verification.didit.me/v3/workflows/", {\n      method: "GET",\n      headers: {\n        "x-api-key": apiKey,\n        "Content-Type": "application/json",\n      },\n      signal: AbortSignal.timeout(20_000),\n    });\n  } catch (error) {\n    throw new VerificationRuntimeError(\n      "verification_provider_unreachable",\n      error instanceof Error && error.name === "TimeoutError"\n        ? "The verification provider took too long to respond while resolving the KYC workflow."\n        : "The verification provider could not be reached while resolving the KYC workflow.",\n      503,\n    );\n  }\n\n  let body: unknown;\n  try {\n    body = await response.json();\n  } catch {\n    throw new VerificationRuntimeError(\n      "verification_provider_response_invalid",\n      "The verification provider returned an unreadable workflow response.",\n      502,\n    );\n  }\n\n  if (!response.ok) {\n    const providerBody = recordValue(body);\n    const providerMessage = extractProviderErrorMessage(providerBody);\n    throw new VerificationRuntimeError(\n      response.status === 401 || response.status === 403\n        ? "verification_provider_authentication_failed"\n        : response.status === 429\n        ? "verification_provider_rate_limited"\n        : "verification_provider_request_failed",\n      providerMessage ?? "The verification provider could not list available KYC workflows.",\n      response.status >= 400 && response.status < 600 ? response.status : 502,\n      {\n        providerHttpStatus: response.status,\n        providerMessage: safeProviderMessage(providerMessage),\n      },\n    );\n  }\n\n  if (!Array.isArray(body)) {\n    throw new VerificationRuntimeError(\n      "verification_provider_response_invalid",\n      "The verification provider returned an invalid workflow list.",\n      502,\n    );\n  }\n\n  return body.map(recordValue).filter((workflow) => textValue(workflow.uuid));\n}\n\nasync function persistRecoveredDiditWorkflow(\n  serviceClient: SupabaseClient,\n  route: ActiveVerificationRoute,\n  workflow: { uuid: string; label: string; source: string },\n): Promise<void> {\n  const recoveredAt = new Date().toISOString();\n  const result = await serviceClient\n    .from("verification_provider_routes")\n    .update({\n      workflow_ref: workflow.uuid,\n      config: {\n        ...route.config,\n        providerWorkflowStatus: "available",\n        providerWorkflowRecoveredAt: recoveredAt,\n        providerWorkflowRecoveredFrom: route.workflow_ref,\n        providerWorkflowRecoveredLabel: workflow.label,\n        providerWorkflowRecoverySource: workflow.source,\n      },\n      updated_at: recoveredAt,\n    })\n    .eq("id", route.id)\n    .eq("status", "active");\n\n  if (result.error) {\n    console.info(JSON.stringify({\n      severity: "warning",\n      source: "partner-verification",\n      routeId: route.id,\n      message: "Recovered Didit workflow could not be persisted; this request will still continue.",\n      detail: result.error.message,\n    }));\n  }\n}\n\nfunction extractProviderErrorMessage(body: Record<string, unknown>): string | null {\n  const direct =\n    textValue(body.message) ??\n    textValue(body.detail) ??\n    textValue(body.description) ??\n    textValue(body.error) ??\n    textValue(recordValue(body.error).message) ??\n    textValue(recordValue(body.error).detail);\n  if (direct) return direct.slice(0, 500);\n\n  for (const [field, value] of Object.entries(body)) {\n    const nested = flattenProviderErrorValue(value);\n    if (nested) return `${field}: ${nested}`.slice(0, 500);\n  }\n  return null;\n}\n\nfunction flattenProviderErrorValue(value: unknown, depth = 0): string | null {\n  if (depth > 2) return null;\n  const text = textValue(value);\n  if (text) return text;\n  if (Array.isArray(value)) {\n    for (const item of value) {\n      const nested = flattenProviderErrorValue(item, depth + 1);\n      if (nested) return nested;\n    }\n    return null;\n  }\n  const record = recordValue(value);\n  for (const nestedValue of Object.values(record)) {\n    const nested = flattenProviderErrorValue(nestedValue, depth + 1);\n    if (nested) return nested;\n  }\n  return null;\n}\n\nfunction safeProviderMessage(value: string | null): string | null {\n  if (!value) return null;\n  return value.toLowerCase().includes("api key") ? null : value;\n}\n\n`;

  source = source.replace(activeRouteMarker, workflowHelpers + activeRouteMarker);

  source = replaceExact(
    source,
    `    const providerMessage =\n      textValue(body.message) ??\n      textValue(body.detail) ??\n      textValue(body.error) ??\n      textValue(body.description) ??\n      textValue(recordValue(body.error).message) ??\n      textValue(recordValue(body.error).detail);`,
    `    const providerMessage = extractProviderErrorMessage(body);`,
    "Didit field validation error parsing",
  );

  source = replaceExact(
    source,
    `        : providerMessage && !providerMessage.toLowerCase().includes("api key")\n        ? providerMessage\n        : "The verification provider could not complete the request.",`,
    `        : safeProviderMessage(providerMessage)\n        ? safeProviderMessage(providerMessage)!\n        : "The verification provider could not complete the request.",`,
    "safe provider error message",
  );

  source = replaceExact(
    source,
    `        providerMessage: providerMessage && !providerMessage.toLowerCase().includes("api key")\n          ? providerMessage\n          : null,`,
    `        providerMessage: safeProviderMessage(providerMessage),`,
    "safe provider error detail",
  );

  // Make the shared route type reusable by the recovery helper without changing
  // runtime behavior for non-Didit routes.
  source = replaceExact(
    source,
    `): Promise<{\n  id: string;\n  workflow_ref: string;\n  config: Record<string, unknown>;\n  provider: { id: string; key: string; display_name: string };\n} | null> {`,
    `): Promise<ActiveVerificationRoute | null> {`,
    "active route shared type",
  );

  await writeFile(path, source);
}

async function patchApplicationOverviewTheme() {
  const path = "apps/lpg-mobile/src/native/ui/ApplicationOverviewScreen.tsx";
  let source = await readFile(path, "utf8");

  source = replaceExact(
    source,
    `import { useSession } from "../session/SessionProvider";\nimport { colors, radii, spacing } from "../theme/tokens";`,
    `import { useSession } from "../session/SessionProvider";\nimport { useAppTheme } from "../theme/ThemeProvider";\nimport { colors, radii, spacing } from "../theme/tokens";`,
    "application theme import",
  );

  source = replaceExact(
    source,
    `  const session = useSession();\n  const maps = useMapsGatewayAdapter();`,
    `  const session = useSession();\n  const { palette } = useAppTheme();\n  const maps = useMapsGatewayAdapter();`,
    "application theme hook",
  );

  const themeTextReplacements = [
    ["style={styles.link}", "style={[styles.link, { color: palette.brand }]}"],
    ["style={styles.sectionHeader}", "style={[styles.sectionHeader, { color: palette.ink }]}"],
    ["style={styles.fieldLabel}", "style={[styles.fieldLabel, { color: palette.ink }]}"],
    ["style={styles.helperText}", "style={[styles.helperText, { color: palette.muted }]}"],
    ["style={styles.locationBtnText}", "style={[styles.locationBtnText, { color: palette.brand }]}"],
    ["style={styles.coordTitle}", "style={[styles.coordTitle, { color: palette.ink }]}"],
    ["style={styles.coordText}", "style={[styles.coordText, { color: palette.success }]}"],
    ["style={styles.prevBtnText}", "style={[styles.prevBtnText, { color: palette.ink }]}"],
    ["style={styles.error}", "style={[styles.error, { color: palette.danger }]}"],
  ];
  for (const [before, after] of themeTextReplacements) {
    source = replaceAllExact(source, before, after, before);
  }

  source = replaceAllExact(
    source,
    `style={styles.input}`,
    `style={[styles.input, { backgroundColor: palette.input, borderColor: palette.border, color: palette.ink }]}`,
    "themed single-line application inputs",
  );
  source = replaceAllExact(
    source,
    `style={[styles.input, styles.textArea]}`,
    `style={[styles.input, styles.textArea, { backgroundColor: palette.input, borderColor: palette.border, color: palette.ink }]}`,
    "themed multiline application inputs",
  );

  source = source.replace(
    /(\n\s+placeholder="[^"]*"\n)(\s+)(style=)/g,
    (_match, placeholderLine, indent, styleToken) =>
      `${placeholderLine}${indent}placeholderTextColor={palette.muted}\n${indent}${styleToken}`,
  );

  source = replaceAllExact(source, "color={colors.brand}", "color={palette.brand}", "brand icon colors");
  source = replaceAllExact(source, "color={colors.success}", "color={palette.success}", "success icon colors");
  source = replaceAllExact(source, "color={colors.ink}", "color={palette.ink}", "ink icon colors");

  source = replaceExact(
    source,
    `                      style={[\n                        styles.roleChip,\n                        stationRole === role.key && styles.roleChipActive,\n                      ]}`,
    `                      style={[\n                        styles.roleChip,\n                        { borderColor: palette.border, backgroundColor: palette.surface },\n                        stationRole === role.key && styles.roleChipActive,\n                        stationRole === role.key && {\n                          borderColor: palette.brand,\n                          backgroundColor: palette.brandSoft,\n                        },\n                      ]}`,
    "station role chip theme",
  );

  source = replaceExact(
    source,
    `                        style={[\n                          styles.roleChipText,\n                          stationRole === role.key && styles.roleChipTextActive,\n                        ]}`,
    `                        style={[\n                          styles.roleChipText,\n                          { color: palette.muted },\n                          stationRole === role.key && styles.roleChipTextActive,\n                          stationRole === role.key && { color: palette.brand },\n                        ]}`,
    "station role chip text theme",
  );

  source = replaceAllExact(
    source,
    `style={styles.locationBtn}`,
    `style={[styles.locationBtn, { borderColor: palette.brand, backgroundColor: palette.brandSoft }]}`,
    "location button theme",
  );
  source = replaceAllExact(
    source,
    `style={styles.coordBox}`,
    `style={[styles.coordBox, { backgroundColor: palette.successSoft }]}`,
    "coordinate status theme",
  );
  source = replaceAllExact(
    source,
    `style={styles.prevBtn}`,
    `style={[styles.prevBtn, { borderColor: palette.border, backgroundColor: palette.surface }]}`,
    "previous button theme",
  );
  source = replaceAllExact(
    source,
    `style={styles.nextBtn}`,
    `style={[styles.nextBtn, { backgroundColor: palette.brand }]}`,
    "next button theme",
  );
  source = replaceExact(
    source,
    `style={[styles.submitBtn, (!canSubmit || submitting) && styles.btnDisabled]}`,
    `style={[\n              styles.submitBtn,\n              { backgroundColor: palette.success },\n              (!canSubmit || submitting) && styles.btnDisabled,\n            ]}`,
    "submit button theme",
  );

  await writeFile(path, source);
}

async function patchVerificationContract() {
  const path = "scripts/verification-runtime-contract.test.ts";
  let source = await readFile(path, "utf8");

  const marker = `Deno.test("verification runtime is JWT protected", () => {`;
  if (!source.includes(marker)) {
    throw new Error("Phase 1 patch could not find verification contract insertion point");
  }

  const tests = `Deno.test("Didit personal KYC accepts configured partner audiences and recovers stale workflow UUIDs", async () => {\n  const rolePolicy = await read(\n    "supabase/migrations/20260911105500_didit_role_alias_workflow_recovery.sql",\n  );\n\n  assertStringIncludes(rolePolicy, "'provider_audience', 'driver'");\n  assertStringIncludes(rolePolicy, "'provider_audience', 'station_rep'");\n  assertStringIncludes(rolePolicy, "'station_representative'");\n  assertStringIncludes(rolePolicy, "'workflowRecoveryEnabled', true");\n  assertStringIncludes(sharedVerification, "routeAllowsAudience");\n  assertStringIncludes(sharedVerification, "providerAudienceAliases");\n  assertStringIncludes(sharedVerification, "createDiditSessionWithWorkflowRecovery");\n  assertStringIncludes(sharedVerification, '"https://verification.didit.me/v3/workflows/"');\n  assertStringIncludes(sharedVerification, "extractProviderErrorMessage");\n  assertStringIncludes(sharedVerification, "providerWorkflowRecoveredAt");\n  assert(\n    !sharedVerification.includes("application.lpg.driver") &&\n      !sharedVerification.includes("application.lpg.station"),\n    "The provider runtime must resolve applicant audience from configuration, not LPG application keys.",\n  );\n});\n\nDeno.test("driver and station onboarding form colors follow the active app palette", () => {\n  assertStringIncludes(applicationScreen, "useAppTheme");\n  assertStringIncludes(applicationScreen, "const { palette } = useAppTheme()");\n  assertStringIncludes(applicationScreen, "placeholderTextColor={palette.muted}");\n  assertStringIncludes(applicationScreen, "backgroundColor: palette.input");\n  assertStringIncludes(applicationScreen, "color: palette.ink");\n  assertStringIncludes(applicationScreen, "backgroundColor: palette.brandSoft");\n  assertStringIncludes(applicationScreen, "backgroundColor: palette.successSoft");\n});\n\n`;
  source = source.replace(marker, tests + marker);
  await writeFile(path, source);
}

await patchPartnerVerification();
await patchApplicationOverviewTheme();
await patchVerificationContract();
console.log("Phase 1 verification + dark-mode source patches applied.");
