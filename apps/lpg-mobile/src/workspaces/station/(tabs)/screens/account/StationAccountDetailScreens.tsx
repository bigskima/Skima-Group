import { BarChart3, Boxes, Building2, CalendarClock, CheckCircle2, CircleAlert, FileCheck2, Gauge, MailPlus, MapPin, PackageCheck, ShieldCheck, UserRoundCog, Users, WalletCards } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import { PermissionGuard } from "@lpg/app/guards/PermissionGuard";
import { findLpgApplicationType, useApplicationsQuery, useApplicationTypesQuery, useDocumentsQuery, useDocumentRequirementsQuery } from "@lpg/features/applications/api";
import { useCurrenciesQuery, useLpgConfigQuery } from "@lpg/features/config/api";
import { firstLinkedMediaAssetId, useEntityMediaLinksQuery } from "@lpg/features/media/api";
import { firstMediaAssetId, RuntimeMediaImage } from "@lpg/features/media/RuntimeMediaImage";
import { useOrganizationBranchesQuery, useOrganizationInvitationsQuery, useOrganizationRolesQuery, useOrganizationStaffDirectoryQuery } from "@lpg/features/organization/api";
import { useStationRuntimeQuery } from "@lpg/features/stations/api";
import { useSettlementsQuery } from "@lpg/features/wallet/api";
import {
  ActionResponseSchema,
  createLpgIdempotencyKey,
  displayReference,
  formatStatus,
  getConfigRecords,
  getFirstRecordNumber,
  getFirstRecordString,
  getPolicyRecord,
  getRecordArray,
  getRecordId,
  getRecordObject,
  getStatus,
  recordKey,
  statusTone,
  type ActionResult,
  type PlatformRecord,
} from "@lpg/shared/api/records";
import { mutationErrorMessage, useGatewayMutation } from "@lpg/shared/api/useGatewayMutation";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { MenuRow, MetricCard, PolishedEmpty, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { AccountSkeleton, ActivityListSkeleton, StationDashboardSkeleton, WorkflowFormSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { RecordField, WorkflowForm, WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import { displayMoney, resolveCurrencyCode } from "@lpg/shared/utilities/display";
import { formatDateValue } from "@lpg/shared/utilities/lpgFormat";
import type { StationScreenProps } from "../../navigation/stationRoutes";

export function StationProfileScreen(props: StationScreenProps) {
  const runtime = useStationRuntimeQuery();
  const branch = getRecordObject(runtime.data, "branch");
  const mediaLinks = useEntityMediaLinksQuery("lpg.station_branch", getRecordId(branch));
  const operatingHours = getRecordObject(branch, "operatingHours");
  const sizes = numberArray(branch?.["supportedCylinderSizesKg"]);
  return <QueryState loading={runtime.isLoading || mediaLinks.isLoading} error={runtime.error ?? mediaLinks.error} skeleton={<AccountSkeleton />}>
    <WorkflowHeader title="Station Profile" subtitle="Approved branch identity" onBack={props.navigation.goBack} />
    {branch ? <>
      <section className="profile-card"><div className="avatar-large"><RuntimeMediaImage assetId={firstLinkedMediaAssetId(mediaLinks.data, "station.photo")} alt="Station image" fallback={<Building2 aria-hidden="true" />} /></div><div><h2>{getFirstRecordString(branch, ["displayName"]) ?? "Station"}</h2><p>{getFirstRecordString(branch, ["formattedAddress"]) ?? "Address unavailable"}</p><StatusChip tone={statusTone(getFirstRecordString(branch, ["complianceStatus"]))} label={formatStatus(getFirstRecordString(branch, ["complianceStatus"]))} /></div></section>
      <section className="panel-card"><RecordField label="Approval" value={formatStatus(getFirstRecordString(branch, ["approvalStatus"]))} /><RecordField label="Availability" value={formatStatus(getFirstRecordString(branch, ["availabilityStatus"]))} /><RecordField label="Operating hours" value={formatOperatingHours(operatingHours)} /><RecordField label="Service radius" value={`${getFirstRecordNumber(branch, ["serviceRadiusMeters"]) ?? "Not available"} m`} /><RecordField label="Supported cylinders" value={sizes.length > 0 ? sizes.map((size) => `${size} kg`).join(", ") : "Not configured"} /><RecordField label="Coordinates" value={formatCoordinates(branch)} /></section>
    </> : <PolishedEmpty icon={<Building2 />} title="Station profile unavailable" message="No accessible approved branch was returned." />}
  </QueryState>;
}

export function StationInventoryScreen(props: StationScreenProps) {
  const runtime = useStationRuntimeQuery();
  const branch = getRecordObject(runtime.data, "branch");
  const orders = getRecordArray(runtime.data, "orders");
  const atStation = orders.filter((order) => ["station_verified", "refill_in_progress", "refill_confirmed", "station_settled"].includes(getStatus(order)));
  const available = getFirstRecordNumber(branch, ["currentAvailableKg"]);
  const capacity = getFirstRecordNumber(branch, ["refillCapacityKg"]);
  const remainingCapacity = capacity !== null && available !== null ? capacity - available : null;
  const [replenishmentKg, setReplenishmentKg] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<Error | null>(null);
  const mutation = useGatewayMutation<ActionResult, Record<string, unknown>>({ invalidate: [["station-runtime"], ["stations"]], path: "/lpg/stations/capacity-adjustments", schema: ActionResponseSchema });
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);
    setNotice(null);
    try {
      const stationBranchId = getRecordId(branch);
      const adjustmentKg = Number(replenishmentKg);
      if (!stationBranchId) throw new Error("An approved station branch is required.");
      if (!Number.isFinite(adjustmentKg) || adjustmentKg <= 0) throw new Error("Enter a valid replenishment amount.");
      if (remainingCapacity !== null && adjustmentKg > remainingCapacity) throw new Error("The replenishment exceeds the remaining station capacity.");
      await mutation.mutateAsync({ adjustmentKg, idempotencyKey: createLpgIdempotencyKey("station-capacity-replenishment", stationBranchId), reasonKey: "lpg.capacity.replenishment", source: "skima.lpg.mobile", stationBranchId });
      setReplenishmentKg("");
      setNotice("Capacity replenishment recorded.");
    } catch (error) {
      setLocalError(error instanceof Error ? error : new Error("Capacity could not be updated."));
    }
  };

  return <QueryState loading={runtime.isLoading} error={runtime.error} skeleton={<StationDashboardSkeleton />}>
    <WorkflowHeader title="Inventory And Capacity" subtitle="Branch stock and cylinders in process" onBack={props.navigation.goBack} />
    <section className="capacity-panel"><div><span>Available refill stock</span><strong>{available ?? "Not available"} kg</strong><small>of {capacity ?? "unconfigured"} kg capacity</small></div><Gauge aria-hidden="true" /><progress value={available ?? 0} max={capacity && capacity > 0 ? capacity : 1} /></section>
    <section className="panel-card"><h2>Cylinders At Station</h2>{atStation.map((order, index) => { const cylinder = getRecordObject(order, "cylinder"); return <article className="inventory-runtime-row" key={recordKey(order, `station-cylinder-${index}`)}><RuntimeMediaImage assetId={firstMediaAssetId(cylinder)} alt="Customer cylinder" /><div><strong>{displayReference(cylinder, "Cylinder")}</strong><span>{getFirstRecordNumber(cylinder, ["sizeKg"]) ?? "Configured"} kg</span></div><StatusChip tone={statusTone(getStatus(order))} label={formatStatus(getStatus(order))} /></article>; })}{atStation.length === 0 ? <PolishedEmpty icon={<PackageCheck />} title="No cylinders at station" message="Verified incoming cylinders will appear here during refill." /> : null}</section>
    <PermissionGuard context={props.context} permissions={["lpg.stations.manage"]}>{remainingCapacity !== null && remainingCapacity > 0 ? <WorkflowForm error={localError ?? mutation.error} isPending={mutation.isPending} notice={notice} onSubmit={(event) => void submit(event)} submitLabel="Record Replenishment"><label>Kilograms received<input type="number" min="0.001" max={remainingCapacity} step="0.001" value={replenishmentKg} onChange={(event) => setReplenishmentKg(event.currentTarget.value)} required /></label></WorkflowForm> : capacity !== null && available !== null ? <p className="form-message is-success">Station refill capacity is fully replenished.</p> : null}</PermissionGuard>
  </QueryState>;
}

export function StationStaffScreen(props: StationScreenProps) {
  const runtime = useStationRuntimeQuery();
  const config = useLpgConfigQuery();
  const roles = useOrganizationRolesQuery();
  const branches = useOrganizationBranchesQuery();
  const invitations = useOrganizationInvitationsQuery();
  const branch = getRecordObject(runtime.data, "branch");
  const organizationId = getFirstRecordString(branch, ["organizationId"]);
  const directory = useOrganizationStaffDirectoryQuery(organizationId);
  const organizationRoles = (roles.data ?? []).filter((role) => getFirstRecordString(role, ["organization_id", "organizationId"]) === organizationId);
  const presets = getConfigRecords(config.data, "stationRolePresets");
  const inviteableRoles = organizationRoles.filter((role) => getFirstRecordString(role, ["key"]) !== "lpg.station.owner");
  const organizationBranch = (branches.data ?? []).find((record) => getRecordId(record) === getFirstRecordString(branch, ["branchId"]));
  const staffPolicy = getPolicyRecord(config.data, "lpg.station_staff.phase_one");
  const invitationTtlHours = getFirstRecordNumber(staffPolicy, ["invitation_ttl_hours", "invitationTtlHours"]);
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const invite = useGatewayMutation<ActionResult, Record<string, unknown>>({ invalidate: [["organization-invitations"], ["organization-staff-directory"]], path: "/runtime/organization-invitations", schema: ActionResponseSchema });
  const statusMutation = useGatewayMutation<ActionResult, Record<string, unknown>>({ invalidate: [["organization-memberships"], ["organization-user-roles"], ["organization-staff-directory"]], path: "/runtime/organization-staff/status", schema: ActionResponseSchema });

  const submitInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organizationId || invitationTtlHours === null || !roleKey) return;
    const preset = presets.find((record) => getFirstRecordString(record, ["roleKey", "role_key"]) === roleKey);
    try {
      await invite.mutateAsync({ branchKey: getFirstRecordString(organizationBranch, ["key"]), expiresAt: new Date(Date.now() + invitationTtlHours * 60 * 60 * 1000).toISOString(), idempotencyKey: createLpgIdempotencyKey("station-staff-invite", email.trim().toLowerCase()), invitedEmail: email.trim().toLowerCase(), membershipType: getFirstRecordString(preset, ["membershipType", "membership_type"]) ?? "member", organizationId, roleKey, source: "skima.lpg.mobile" });
      setEmail("");
      setRoleKey("");
      setNotice("Staff invitation created.");
    } catch {
      // React Query exposes the request error through invite.error.
    }
  };

  const changeStatus = (member: PlatformRecord, status: "active" | "removed" | "suspended") => {
    const userId = getFirstRecordString(member, ["userId"]);
    if (!organizationId || !userId || userId === props.context.user.id) return;
    if (status === "removed" && !window.confirm("Remove this staff member from the station organization?")) return;
    statusMutation.mutate({ idempotencyKey: createLpgIdempotencyKey(`station-staff-${status}`, userId), organizationId, reason: "station.account.staff_status", status, userId });
  };

  const loading = runtime.isLoading || config.isLoading || roles.isLoading || branches.isLoading || invitations.isLoading || directory.isLoading;
  const error = runtime.error ?? config.error ?? roles.error ?? branches.error ?? invitations.error ?? directory.error;
  return <PermissionGuard context={props.context} permissions={["business.staff.manage"]} fallback={<RestrictedAccountScreen props={props} title="Staff" />}>
    <QueryState loading={loading} error={error} skeleton={<ActivityListSkeleton />}>
      <WorkflowHeader title="Station Staff" subtitle="Branch members, roles, and invitations" onBack={props.navigation.goBack} />
      <section className="staff-directory">{(directory.data ?? []).map((member, index) => { const memberStatus = getFirstRecordString(member, ["status"]); const assignedRoles = getRecordArray(member, "roles"); return <article className="staff-member-card" key={recordKey(member, `staff-${index}`)}><div className="avatar-large"><Users aria-hidden="true" /></div><div><h2>{getFirstRecordString(member, ["displayName"]) ?? "Station member"}</h2><p>{getFirstRecordString(member, ["email"]) ?? "Email unavailable"}</p><div className="status-chip-row">{assignedRoles.map((role, roleIndex) => <StatusChip key={recordKey(role, `staff-role-${roleIndex}`)} tone="info" label={getFirstRecordString(role, ["roleName"]) ?? formatStatus(getFirstRecordString(role, ["roleKey"]))} />)}<StatusChip tone={statusTone(memberStatus)} label={formatStatus(memberStatus)} /></div></div>{getFirstRecordString(member, ["userId"]) !== props.context.user.id ? <div className="staff-actions"><button type="button" className="text-button" onClick={() => changeStatus(member, memberStatus === "suspended" ? "active" : "suspended")}>{memberStatus === "suspended" ? "Reactivate" : "Suspend"}</button><button type="button" className="text-button danger-text" onClick={() => changeStatus(member, "removed")}>Remove</button></div> : null}</article>; })}</section>
      <section className="panel-card"><h2>Pending Invitations</h2>{(invitations.data ?? []).filter((record) => getFirstRecordString(record, ["organization_id", "organizationId"]) === organizationId && getFirstRecordString(record, ["status"]) === "pending").map((record, index) => <MenuRow key={recordKey(record, `invitation-${index}`)} icon={<MailPlus />} title={getFirstRecordString(record, ["invited_email", "invitedEmail"]) ?? "Invited staff"} text={`Expires ${formatDateValue(getFirstRecordString(record, ["expires_at", "expiresAt"]) ?? "")}`} trailing={<StatusChip tone="warning" label="Pending" />} />)}</section>
      {invitationTtlHours === null ? <p className="form-message is-error"><CircleAlert aria-hidden="true" />Station invitation policy is unavailable.</p> : <WorkflowForm error={invite.error ?? statusMutation.error} isPending={invite.isPending} notice={notice} onSubmit={(event) => void submitInvite(event)} submitLabel="Invite Staff"><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} required /></label><label>Station role<select value={roleKey} onChange={(event) => setRoleKey(event.currentTarget.value)} required><option value="">Choose role</option>{inviteableRoles.map((role, index) => { const key = getFirstRecordString(role, ["key"]) ?? ""; return <option key={recordKey(role, `invite-role-${index}`)} value={key}>{getFirstRecordString(role, ["display_name", "displayName"]) ?? formatStatus(key)}</option>; })}</select></label></WorkflowForm>}
    </QueryState>
  </PermissionGuard>;
}

export function StationRolesScreen(props: StationScreenProps) {
  const runtime = useStationRuntimeQuery();
  const config = useLpgConfigQuery();
  const roles = useOrganizationRolesQuery();
  const organizationId = getFirstRecordString(getRecordObject(runtime.data, "branch"), ["organizationId"]);
  const organizationRoles = (roles.data ?? []).filter((record) => getFirstRecordString(record, ["organization_id", "organizationId"]) === organizationId);
  const presets = getConfigRecords(config.data, "stationRolePresets");
  return <PermissionGuard context={props.context} permissions={["business.staff.manage"]} fallback={<RestrictedAccountScreen props={props} title="Roles" />}>
    <QueryState loading={runtime.isLoading || config.isLoading || roles.isLoading} error={runtime.error ?? config.error ?? roles.error} skeleton={<ActivityListSkeleton />}>
      <WorkflowHeader title="Roles And Permissions" subtitle="Backend-configured station access" onBack={props.navigation.goBack} />
      <section className="panel-card">{organizationRoles.map((role, index) => { const roleKey = getFirstRecordString(role, ["key"]); const preset = presets.find((record) => getFirstRecordString(record, ["roleKey", "role_key"]) === roleKey); const permissionKeys = stringArray(preset?.["permissionKeys"] ?? preset?.["permission_keys"]); return <button type="button" className="unstyled-record-button" key={recordKey(role, `station-role-${index}`)} onClick={() => props.navigation.navigate("permissions", { roleKey: roleKey ?? "" })}><MenuRow icon={<UserRoundCog />} title={getFirstRecordString(role, ["display_name", "displayName"]) ?? formatStatus(roleKey)} text={`${permissionKeys.length} configured permissions`} /></button>; })}</section>
    </QueryState>
  </PermissionGuard>;
}

export function StationPermissionsScreen(props: StationScreenProps) {
  const config = useLpgConfigQuery();
  const roleKey = props.navigation.params.roleKey ?? null;
  const preset = getConfigRecords(config.data, "stationRolePresets").find((record) => getFirstRecordString(record, ["roleKey", "role_key"]) === roleKey) ?? null;
  const permissions = stringArray(preset?.["permissionKeys"] ?? preset?.["permission_keys"]);
  return <PermissionGuard context={props.context} permissions={["business.staff.manage"]} fallback={<RestrictedAccountScreen props={props} title="Permissions" />}>
    <QueryState loading={config.isLoading} error={config.error} skeleton={<ActivityListSkeleton />}>
      <WorkflowHeader title={getFirstRecordString(preset, ["displayName", "display_name"]) ?? "Role Permissions"} subtitle="Configured by the LPG station role preset" onBack={props.navigation.goBack} />
      <section className="panel-card permission-key-list">{permissions.map((permission) => <MenuRow key={permission} icon={<ShieldCheck />} title={formatStatus(permission)} text={permission} trailing={<CheckCircle2 aria-label="Enabled" />} />)}{permissions.length === 0 ? <PolishedEmpty icon={<ShieldCheck />} title="No permission preset" message="This role does not have an active LPG permission preset." /> : null}</section>
    </QueryState>
  </PermissionGuard>;
}

export function StationSettingsScreen(props: StationScreenProps) {
  const runtime = useStationRuntimeQuery();
  const config = useLpgConfigQuery();
  const currencies = useCurrenciesQuery();
  const branch = getRecordObject(runtime.data, "branch");
  const branchId = getRecordId(branch);
  const runtimePricing = getRecordArray(runtime.data, "pricing")[0] ?? null;
  const fallbackPricing = getConfigRecords(config.data, "pricing").find((record) => !getFirstRecordString(record, ["stationBranchId", "station_branch_id"])) ?? null;
  const pricing = runtimePricing ?? fallbackPricing;
  const [availabilityStatus, setAvailabilityStatus] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [pricePerKg, setPricePerKg] = useState("");
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [pricingNotice, setPricingNotice] = useState<string | null>(null);
  const settingsMutation = useGatewayMutation<ActionResult, Record<string, unknown>>({ invalidate: [["station-runtime"], ["stations"]], path: "/lpg/stations/settings", schema: ActionResponseSchema });
  const pricingMutation = useGatewayMutation<ActionResult, Record<string, unknown>>({ invalidate: [["station-runtime"], ["config"]], path: "/lpg/config", schema: ActionResponseSchema });

  useEffect(() => {
    if (branch) {
      const hours = getRecordObject(branch, "operatingHours");
      setAvailabilityStatus(getFirstRecordString(branch, ["availabilityStatus"]) ?? "");
      setOpensAt(getFirstRecordString(hours, ["opensAt", "opens_at"]) ?? "");
      setClosesAt(getFirstRecordString(hours, ["closesAt", "closes_at"]) ?? "");
    }
    const price = getFirstRecordNumber(pricing, ["pricePerKg", "price_per_kg"]);
    setPricePerKg(price === null ? "" : String(price));
  }, [branch, pricing]);

  const saveOperations = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!branchId) return;
    try {
      await settingsMutation.mutateAsync({ availabilityStatus, idempotencyKey: createLpgIdempotencyKey("station-settings", branchId), operatingHours: { closesAt, opensAt }, source: "skima.lpg.mobile", stationBranchId: branchId });
      setSettingsNotice("Station operations updated.");
    } catch {
      // React Query exposes the request error through settingsMutation.error.
    }
  };
  const savePrice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!branchId) return;
    try {
      await pricingMutation.mutateAsync({ configType: "stationPrice", idempotencyKey: createLpgIdempotencyKey("station-price", branchId), pricePerKg: Number(pricePerKg), source: "skima.lpg.mobile", stationBranchId: branchId });
      setPricingNotice("Branch price updated from backend policy.");
    } catch {
      // React Query exposes the request error through pricingMutation.error.
    }
  };
  const currencyCode = resolveCurrencyCode(currencies.data ?? [], pricing);

  return <PermissionGuard context={props.context} permissions={["lpg.stations.manage"]} fallback={<RestrictedAccountScreen props={props} title="Station Settings" />}>
    <QueryState loading={runtime.isLoading || config.isLoading || currencies.isLoading} error={runtime.error ?? config.error ?? currencies.error} skeleton={<WorkflowFormSkeleton />}>
      <WorkflowHeader title="Station Settings" subtitle="Operations and controlled branch pricing" onBack={props.navigation.goBack} />
      <WorkflowForm error={settingsMutation.error} isPending={settingsMutation.isPending} notice={settingsNotice} onSubmit={(event) => void saveOperations(event)} submitLabel="Save Operations"><label>Availability<select value={availabilityStatus} onChange={(event) => setAvailabilityStatus(event.currentTarget.value)} required><option value="available">Available</option><option value="paused">Paused</option><option value="closed">Closed</option><option value="unavailable">Unavailable</option></select></label><div className="form-grid two-column"><label>Opens<input type="time" value={opensAt} onChange={(event) => setOpensAt(event.currentTarget.value)} required /></label><label>Closes<input type="time" value={closesAt} onChange={(event) => setClosesAt(event.currentTarget.value)} required /></label></div></WorkflowForm>
      <WorkflowForm error={pricingMutation.error} isPending={pricingMutation.isPending} notice={pricingNotice} onSubmit={(event) => void savePrice(event)} submitLabel="Update Branch Price"><label>Price per kilogram<input type="number" min="0.01" step="0.01" value={pricePerKg} onChange={(event) => setPricePerKg(event.currentTarget.value)} required /></label><p className="action-copy"><WalletCards aria-hidden="true" />Currency: {currencyCode ?? "Backend configured"}. Delivery, platform, tax, and driver amounts remain server-managed.</p></WorkflowForm>
    </QueryState>
  </PermissionGuard>;
}

export function StationReportsScreen(props: StationScreenProps) {
  const runtime = useStationRuntimeQuery();
  const settlements = useSettlementsQuery();
  const summary = getRecordObject(runtime.data, "summary");
  const orders = getRecordArray(runtime.data, "orders");
  const currencyCode = getFirstRecordString(settlements.data?.[0], ["currency_code", "currencyCode"]);
  const settledTotal = (settlements.data ?? []).reduce((total, record) => total + (getFirstRecordNumber(record, ["net_amount", "netAmount"]) ?? 0), 0);
  return <QueryState loading={runtime.isLoading || settlements.isLoading} error={runtime.error ?? settlements.error} skeleton={<StationDashboardSkeleton />}>
    <WorkflowHeader title="Station Reports" subtitle="Live operational and settlement totals" onBack={props.navigation.goBack} />
    <div className="metric-grid"><MetricCard icon={<Boxes />} value={String(getFirstRecordNumber(summary, ["activeJobs"]) ?? 0)} label="Active Jobs" /><MetricCard icon={<PackageCheck />} value={String(getFirstRecordNumber(summary, ["completedJobs"]) ?? 0)} label="Completed Jobs" /><MetricCard icon={<Gauge />} value={`${getFirstRecordNumber(summary, ["totalRefilledKg"]) ?? 0} kg`} label="Total Refilled" /><MetricCard icon={<WalletCards />} value={displayMoney(settledTotal, currencyCode)} label="Settled Earnings" /></div>
    <section className="panel-card"><h2>Recent Completed Work</h2>{orders.filter((order) => ["delivered", "completed"].includes(getStatus(order))).map((order, index) => <MenuRow key={recordKey(order, `completed-order-${index}`)} icon={<BarChart3 />} title={displayReference(order, "Order")} text={`${getFirstRecordNumber(order, ["actualKg"]) ?? "Pending"} kg filled`} trailing={<strong>{displayMoney(getFirstRecordNumber(order, ["stationAmount"]), getFirstRecordString(order, ["currencyCode"]))}</strong>} />)}</section>
  </QueryState>;
}

export function StationDocumentsScreen(props: StationScreenProps) {
  const types = useApplicationTypesQuery();
  const applications = useApplicationsQuery();
  const requirements = useDocumentRequirementsQuery();
  const documents = useDocumentsQuery();
  const stationTypeId = getRecordId(findLpgApplicationType(types.data, "business"));
  const applicationIds = (applications.data ?? []).filter((application) => getFirstRecordString(application, ["application_type_id", "applicationTypeId"]) === stationTypeId).map((application) => getRecordId(application)).filter((id): id is string => Boolean(id));
  const visibleDocuments = (documents.data ?? []).filter((document) => applicationIds.includes(getFirstRecordString(document, ["application_id", "applicationId"]) ?? ""));
  const loading = types.isLoading || applications.isLoading || requirements.isLoading || documents.isLoading;
  const error = types.error ?? applications.error ?? requirements.error ?? documents.error;
  return <QueryState loading={loading} error={error} skeleton={<ActivityListSkeleton />}>
    <WorkflowHeader title="Station Documents" subtitle="Compliance evidence from approved applications" onBack={props.navigation.goBack} />
    <section className="panel-card">{visibleDocuments.map((document, index) => { const requirementId = getFirstRecordString(document, ["requirement_id", "requirementId"]); const requirement = requirements.data?.find((record) => getRecordId(record) === requirementId); return <MenuRow key={recordKey(document, `station-document-${index}`)} icon={<FileCheck2 />} title={getFirstRecordString(requirement, ["display_name", "displayName"]) ?? "Station document"} text={formatStatus(getFirstRecordString(document, ["status"]))} trailing={<StatusChip tone={statusTone(getFirstRecordString(document, ["status"]))} label={formatStatus(getFirstRecordString(document, ["status"]))} />} />; })}{visibleDocuments.length === 0 ? <PolishedEmpty icon={<FileCheck2 />} title="No station documents" message="Application compliance records will appear here when accessible." /> : null}</section>
  </QueryState>;
}

function RestrictedAccountScreen(props: { readonly props: StationScreenProps; readonly title: string }) {
  return <section><WorkflowHeader title={props.title} onBack={props.props.navigation.goBack} /><PolishedEmpty icon={<ShieldCheck />} title="Permission required" message="Your current station role does not permit this account operation." /></section>;
}

function numberArray(value: unknown): readonly number[] {
  return Array.isArray(value) ? value.map(Number).filter((item) => Number.isFinite(item)) : [];
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formatOperatingHours(hours: PlatformRecord | null): string {
  const opens = getFirstRecordString(hours, ["opensAt", "opens_at"]);
  const closes = getFirstRecordString(hours, ["closesAt", "closes_at"]);
  return opens && closes ? `${opens} - ${closes}` : "Not configured";
}

function formatCoordinates(branch: PlatformRecord): string {
  const latitude = getFirstRecordNumber(branch, ["latitude"]);
  const longitude = getFirstRecordNumber(branch, ["longitude"]);
  return latitude === null || longitude === null ? "Not available" : `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}
