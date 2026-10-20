import { useQuery } from "@tanstack/react-query";
import { Building2, ClipboardList, RefreshCcw, Truck, WalletCards } from "lucide-react";
import { z } from "zod";

import { Button, ErrorState, LoadingState, PageHeader, StatusBadge } from "@skima/ui";
import { useSessionState } from "./session";

const DriverSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  status: z.string(),
  createdAt: z.string().optional(),
}).passthrough();

const AssignmentSchema = z.object({
  id: z.string(),
  publicReference: z.string().nullable().optional(),
  driverName: z.string(),
  status: z.string(),
  assignedAt: z.string().optional(),
  completedAt: z.string().nullable().optional(),
}).passthrough();

const AgreementSchema = z.object({
  id: z.string(),
  driverName: z.string(),
  agreementMode: z.string(),
  agreementStatus: z.string(),
  terms: z.unknown().optional(),
  notes: z.string().nullable().optional(),
  effectiveFrom: z.string().optional(),
  effectiveUntil: z.string().nullable().optional(),
}).passthrough();

const PaymentSchema = z.object({
  id: z.string(),
  driverName: z.string(),
  publicReference: z.string().nullable().optional(),
  currencyCode: z.string(),
  amount: z.coerce.number(),
  paymentMethod: z.string(),
  paymentStatus: z.string(),
  externalReference: z.string().nullable().optional(),
  confirmationNotes: z.string().nullable().optional(),
  confirmedAt: z.string(),
}).passthrough();

const StationSchema = z.object({
  stationBranchId: z.string().uuid(),
  stationName: z.string(),
  organizationName: z.string(),
  approvalStatus: z.string(),
  complianceStatus: z.string(),
  stationManagedEnabled: z.boolean(),
  deliveryPricingMode: z.enum(["separate", "included", "free"]),
  deliveryFeeAmount: z.coerce.number(),
  driverCompensationMode: z.enum(["in_app_plan", "offline"]),
  currencyCode: z.string(),
  updatedAt: z.string().nullable().optional(),
  driverCount: z.coerce.number(),
  activeDriverCount: z.coerce.number(),
  activeOrderCount: z.coerce.number(),
  assignmentCount: z.coerce.number(),
  activeAgreementCount: z.coerce.number(),
  paymentRecordCount: z.coerce.number(),
  drivers: z.array(DriverSchema).default([]),
  assignments: z.array(AssignmentSchema).default([]),
  agreements: z.array(AgreementSchema).default([]),
  payments: z.array(PaymentSchema).default([]),
}).passthrough();

type StationManagedRecord = z.infer<typeof StationSchema>;

export function AdminStationManagedFulfillmentWorkspace() {
  const { status, supabase } = useSessionState();
  const query = useQuery({
    queryKey: ["admin-station-managed-fulfillment"],
    enabled: status === "authenticated",
    queryFn: async (): Promise<StationManagedRecord[]> => {
      const result = await supabase.rpc("read_lpg_admin_station_managed_fulfillment", {
        target_station_branch_id: null,
      });
      if (result.error) throw result.error;
      return z.array(StationSchema).parse(result.data ?? []);
    },
  });

  const stations = query.data ?? [];
  const enabledCount = stations.filter((station) => station.stationManagedEnabled).length;
  const activeOrders = stations.reduce((total, station) => total + station.activeOrderCount, 0);
  const paymentRecords = stations.reduce((total, station) => total + station.paymentRecordCount, 0);

  return (
    <>
      <PageHeader
        eyebrow="LPG partner oversight"
        title="Station Managed Fulfillment"
        description="Review station-owned delivery settings, driver assignments, offline agreements and payment confirmations. These records are for oversight; SKIMA does not pay Station Managed drivers."
        actions={<Button icon={RefreshCcw} variant="outline" isLoading={query.isFetching} onClick={() => void query.refetch()}>Refresh</Button>}
      />

      {query.isLoading ? <LoadingState label="Loading Station Managed records" /> : null}
      {query.error ? <ErrorState title="Station Managed data unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} /> : null}

      {query.data && !query.error ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: "0.8rem", marginBottom: "1rem" }}>
            <Metric label="Stations enabled" value={`${enabledCount} / ${stations.length}`} icon={<Building2 aria-hidden="true" size={19} />} />
            <Metric label="Active deliveries" value={String(activeOrders)} icon={<ClipboardList aria-hidden="true" size={19} />} />
            <Metric label="Station drivers" value={String(stations.reduce((total, station) => total + station.activeDriverCount, 0))} icon={<Truck aria-hidden="true" size={19} />} />
            <Metric label="Driver payment records" value={String(paymentRecords)} icon={<WalletCards aria-hidden="true" size={19} />} />
          </div>

          {stations.length ? (
            <div style={{ display: "grid", gap: "0.9rem" }}>
              {stations.map((station) => <StationCard key={station.stationBranchId} station={station} />)}
            </div>
          ) : (
            <section className="sk-panel"><p className="skima-muted">No station branches were returned for your admin access.</p></section>
          )}
        </>
      ) : null}
    </>
  );
}

function StationCard({ station }: { readonly station: StationManagedRecord }) {
  const fee = station.deliveryPricingMode === "separate"
    ? formatMoney(station.deliveryFeeAmount, station.currencyCode)
    : station.deliveryPricingMode === "included" ? "Included in refill price" : "Free to customer";

  return (
    <article className="sk-panel" style={{ display: "grid", gap: "0.9rem" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.7rem", minWidth: 0 }}>
          <Building2 aria-hidden="true" size={23} />
          <div>
            <h2 style={{ margin: 0 }}>{station.stationName}</h2>
            <p className="skima-muted" style={{ margin: "0.25rem 0" }}>{station.organizationName}</p>
            <p className="skima-muted" style={{ margin: 0 }}>Branch ID: {station.stationBranchId}</p>
          </div>
        </div>
        <StatusBadge tone={station.stationManagedEnabled ? "success" : "warning"}>
          {station.stationManagedEnabled ? "Station Managed enabled" : "Station Managed disabled"}
        </StatusBadge>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: "0.7rem" }}>
        <Summary label="Customer delivery" value={fee} />
        <Summary label="Driver compensation" value={station.driverCompensationMode === "offline" ? "Offline station agreement" : "Station-defined in-app plan"} />
        <Summary label="Drivers" value={`${station.activeDriverCount} active / ${station.driverCount} registered`} />
        <Summary label="Open deliveries" value={String(station.activeOrderCount)} />
        <Summary label="Active agreements" value={String(station.activeAgreementCount)} />
        <Summary label="Payment records" value={String(station.paymentRecordCount)} />
      </div>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <StatusBadge tone={station.approvalStatus === "approved" ? "success" : "warning"}>Approval: {station.approvalStatus}</StatusBadge>
        <StatusBadge tone={station.complianceStatus === "approved" ? "success" : "warning"}>Compliance: {station.complianceStatus}</StatusBadge>
      </div>

      <details>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>Review drivers, assignments, agreements and payment confirmations</summary>
        <div style={{ display: "grid", gap: "1rem", marginTop: "0.9rem" }}>
          <RecordSection title="Station drivers" empty="No station drivers registered.">
            {station.drivers.map((driver) => (
              <RecordRow key={driver.id} title={driver.displayName} detail={`Status: ${driver.status}`} />
            ))}
          </RecordSection>

          <RecordSection title="Recent delivery assignments" empty="No station-managed assignments recorded.">
            {station.assignments.map((assignment) => (
              <RecordRow
                key={assignment.id}
                title={assignment.publicReference || assignment.id}
                detail={`${assignment.driverName} · ${assignment.status} · assigned ${formatDate(assignment.assignedAt)}`}
              />
            ))}
          </RecordSection>

          <RecordSection title="Driver agreements" empty="No driver agreements recorded.">
            {station.agreements.map((agreement) => (
              <RecordRow
                key={agreement.id}
                title={`${agreement.driverName} · ${agreement.agreementMode.replaceAll("_", " ")}`}
                detail={`${agreement.agreementStatus} · effective ${formatDate(agreement.effectiveFrom)}${agreement.notes ? ` · ${agreement.notes}` : ""}`}
              />
            ))}
          </RecordSection>

          <RecordSection title="Station-entered driver payment confirmations" empty="No station driver payment records recorded.">
            {station.payments.map((payment) => (
              <RecordRow
                key={payment.id}
                title={`${payment.driverName} · ${formatMoney(payment.amount, payment.currencyCode)}`}
                detail={`${payment.paymentStatus} via ${payment.paymentMethod.replaceAll("_", " ")} · ${formatDate(payment.confirmedAt)}${payment.publicReference ? ` · order ${payment.publicReference}` : ""}${payment.externalReference ? ` · ref ${payment.externalReference}` : ""}`}
              />
            ))}
            <p className="skima-muted" style={{ margin: 0, fontSize: "0.85rem" }}>These are station-entered confirmations only. SKIMA did not execute these driver payments.</p>
          </RecordSection>
        </div>
      </details>
    </article>
  );
}

function Metric({ label, value, icon }: { readonly label: string; readonly value: string; readonly icon: React.ReactNode }) {
  return (
    <section className="sk-panel" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
      {icon}
      <div><p className="skima-muted" style={{ margin: 0 }}>{label}</p><strong style={{ fontSize: "1.4rem" }}>{value}</strong></div>
    </section>
  );
}

function Summary({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div style={{ border: "1px solid var(--sk-border, #d0d5dd)", borderRadius: 12, padding: "0.8rem" }}>
      <p className="skima-muted" style={{ margin: 0, fontSize: "0.82rem" }}>{label}</p>
      <strong style={{ display: "block", marginTop: "0.3rem" }}>{value}</strong>
    </div>
  );
}

function RecordSection({ title, empty, children }: { readonly title: string; readonly empty: string; readonly children: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section>
      <h3 style={{ margin: "0 0 0.45rem" }}>{title}</h3>
      {hasChildren ? <div style={{ display: "grid", gap: "0.5rem" }}>{children}</div> : <p className="skima-muted">{empty}</p>}
    </section>
  );
}

function RecordRow({ title, detail }: { readonly title: string; readonly detail: string }) {
  return (
    <div style={{ border: "1px solid var(--sk-border, #d0d5dd)", borderRadius: 10, padding: "0.7rem 0.8rem" }}>
      <strong>{title}</strong>
      <p className="skima-muted" style={{ margin: "0.25rem 0 0", fontSize: "0.9rem" }}>{detail}</p>
    </div>
  );
}

function formatMoney(amount: number, currencyCode: string) {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: currencyCode, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toLocaleString("en-NG")}`;
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-NG");
}

function readError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return String((error as { message: string }).message);
  }
  return "Station Managed oversight could not be loaded. Check your station oversight permissions and try again.";
}
