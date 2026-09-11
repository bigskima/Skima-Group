import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  MapPin,
  RefreshCcw,
  Route,
  ShieldCheck,
  Truck,
  WalletCards,
} from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";

import { createClientIdempotencyKey, normalizeStatusLabel } from "@skima/frontend-core";
import {
  Button,
  DataTable,
  DetailList,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  SelectInput,
  StatusBadge,
  type TableColumn,
} from "@skima/ui";

import {
  buildOrderRecordRoute,
  parseOrderRecordRoute,
} from "./features/operations/order-record-route";
import { useSessionState } from "./session";

const OrderSchema = z.object({
  id: z.string().uuid(),
  public_reference: z.string().nullable(),
  station_branch_id: z.string().uuid().nullable(),
  driver_profile_id: z.string().uuid().nullable(),
  currency_code: z.string().default("NGN"),
  requested_kg: z.coerce.number(),
  total_amount: z.coerce.number(),
  station_amount: z.coerce.number().nullable().optional(),
  delivery_fee_amount: z.coerce.number().nullable().optional(),
  platform_fee_amount: z.coerce.number().nullable().optional(),
  driver_commission_amount: z.coerce.number().nullable().optional(),
  status: z.string(),
  payment_status: z.string(),
  assignment_status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough();

const OrdersSchema = z.array(OrderSchema);
type LpgOrder = z.infer<typeof OrderSchema>;

const JobSchema = z.object({
  queue: z.string(),
  lpgOrderId: z.string().uuid(),
  publicReference: z.string().nullable(),
  status: z.string(),
  assignmentStatus: z.string(),
  stationBranchId: z.string().uuid().nullable(),
  stationDisplayName: z.string().nullable(),
  stationAddress: z.string().nullable(),
  driverProfileId: z.string().uuid().nullable(),
  driverDisplayName: z.string().nullable(),
  driverReference: z.string().nullable(),
  driverVerificationStatus: z.string().nullable(),
  cylinderId: z.string().uuid(),
  cylinderReference: z.string().nullable(),
  cylinderIdentifier: z.string().nullable(),
  cylinderSizeKg: z.coerce.number().nullable(),
  requestedKg: z.coerce.number(),
  actualKg: z.coerce.number().nullable(),
  updatedAt: z.string(),
}).passthrough();

const JobsSchema = z.array(JobSchema);
type LpgJob = z.infer<typeof JobSchema>;

const DispatchResultSchema = z.string().uuid();

type QueueFilter = "active" | "attention" | "completed" | "all";

const TERMINAL_STATUSES = new Set(["completed", "cancelled", "refunded", "failed"]);
const RECOVERY_STATUSES = new Set(["payment_reserved", "matching_station", "matching_driver"]);

export function AdminOperationsWorkspace(props: {
  readonly route?: string;
  readonly onNavigate?: (href: string) => void;
} = {}) {
  const { api, status, context } = useSessionState();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<QueueFilter>("active");
  const [notice, setNotice] = useState<string | null>(null);
  const [legacySelectedReference, setLegacySelectedReference] = useState<string | null>(null);
  const controlledRoute = props.route ? parseOrderRecordRoute(props.route) : null;
  const selectedReference = controlledRoute?.kind === "order"
    ? controlledRoute.reference
    : controlledRoute?.kind === "queue"
    ? null
    : legacySelectedReference;

  const canRecoverDispatch = context?.platformAdmin?.admin_kind === "super_admin" ||
    context?.permissions.includes("lpg.dispatch.execute") ||
    context?.permissions.includes("lpg.orders.manage") ||
    false;

  const orders = useQuery({
    queryKey: ["admin-lpg-operations", "orders"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: () => api.get("/lpg/orders", OrdersSchema),
  });

  const jobs = useQuery({
    queryKey: ["admin-lpg-operations", "jobs"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: () => api.get("/lpg/jobs?queue=admin&limit=200", JobsSchema),
  });

  const retryDispatch = useMutation({
    mutationFn: (order: LpgOrder) => api.post(
      "/lpg/orders/dispatch",
      {
        lpgOrderId: order.id,
        candidateLimit: null,
        idempotencyKey: createClientIdempotencyKey("admin.lpg.dispatch.recovery", order.id),
        source: "skima.admin.operations.recovery",
      },
      DispatchResultSchema,
    ),
    onSuccess: async (_dispatchRequestId, order) => {
      setNotice(`Driver matching restarted for ${order.public_reference ?? "this refill"}. The normal SKIMA eligibility rules were used.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-lpg-operations"] }),
        orders.refetch(),
        jobs.refetch(),
      ]);
    },
    onError: (error) => setNotice(readError(error)),
  });

  const jobsByOrderId = useMemo(
    () => new Map((jobs.data ?? []).map((job) => [job.lpgOrderId, job])),
    [jobs.data],
  );

  const allOrders = orders.data ?? [];
  const selectedOrder = selectedReference
    ? allOrders.find((order) => {
      const job = jobsByOrderId.get(order.id);
      return orderRecordReference(order, job) === selectedReference || order.id === selectedReference;
    }) ?? null
    : null;
  const selectedJob = selectedOrder ? jobsByOrderId.get(selectedOrder.id) ?? null : null;

  const visibleOrders = useMemo(() => allOrders.filter((order) => {
    if (filter === "all") return true;
    if (filter === "attention") return needsDispatchRecovery(order);
    if (filter === "completed") return order.status === "completed";
    return !TERMINAL_STATUSES.has(order.status);
  }), [allOrders, filter]);

  const activeCount = allOrders.filter((order) => !TERMINAL_STATUSES.has(order.status)).length;
  const attentionCount = allOrders.filter(needsDispatchRecovery).length;
  const assignedCount = allOrders.filter((order) =>
    !TERMINAL_STATUSES.has(order.status) && Boolean(order.driver_profile_id)
  ).length;
  const inEscrowCount = allOrders.filter((order) =>
    !TERMINAL_STATUSES.has(order.status) &&
    ["reserved", "held", "payment_reserved"].includes(order.payment_status)
  ).length;

  const openOrder = (order: LpgOrder) => {
    const reference = orderRecordReference(order, jobsByOrderId.get(order.id));
    setNotice(null);
    if (props.route && props.onNavigate) {
      props.onNavigate(buildOrderRecordRoute(reference));
      return;
    }
    setLegacySelectedReference(reference);
  };

  const closeOrder = () => {
    if (props.route && props.onNavigate) {
      props.onNavigate("/operations/orders");
      return;
    }
    setLegacySelectedReference(null);
  };

  const columns: TableColumn<LpgOrder>[] = [
    {
      key: "order",
      header: "Refill",
      render: (order) => {
        const job = jobsByOrderId.get(order.id);
        return (
          <span>
            <strong>{order.public_reference ?? job?.publicReference ?? shortId(order.id)}</strong><br />
            <small>{formatDate(order.updated_at)} · {order.requested_kg.toFixed(1)} kg</small>
          </span>
        );
      },
    },
    {
      key: "station",
      header: "Station",
      render: (order) => {
        const job = jobsByOrderId.get(order.id);
        return (
          <span>
            <strong>{job?.stationDisplayName ?? "Station pending"}</strong><br />
            <small>{job?.stationAddress ?? "Address not available"}</small>
          </span>
        );
      },
    },
    {
      key: "driver",
      header: "Driver",
      render: (order) => {
        const job = jobsByOrderId.get(order.id);
        if (!order.driver_profile_id) {
          return <StatusBadge tone={needsDispatchRecovery(order) ? "warning" : "neutral"}>Not assigned</StatusBadge>;
        }
        return (
          <span>
            <strong>{job?.driverDisplayName ?? "Assigned driver"}</strong><br />
            <small>{job?.driverReference ?? shortId(order.driver_profile_id)}</small>
            {job?.driverVerificationStatus ? (
              <> · <StatusBadge tone={job.driverVerificationStatus === "approved" ? "success" : "warning"}>
                {normalizeStatusLabel(job.driverVerificationStatus)}
              </StatusBadge></>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "charges",
      header: "Customer charges",
      render: (order) => (
        <span>
          <strong>{money(order.total_amount, order.currency_code)}</strong><br />
          <small>
            Delivery {money(order.delivery_fee_amount ?? 0, order.currency_code)} · SKIMA fee {money(order.platform_fee_amount ?? 0, order.currency_code)}
          </small>
        </span>
      ),
    },
    {
      key: "state",
      header: "Current state",
      render: (order) => (
        <span>
          <StatusBadge tone={statusTone(order.status)}>{normalizeStatusLabel(order.status)}</StatusBadge><br />
          <small>
            Payment: {normalizeStatusLabel(order.payment_status)} · Assignment: {normalizeStatusLabel(order.assignment_status)}
          </small>
        </span>
      ),
    },
    {
      key: "action",
      header: "Actions",
      render: (order) => (
        <div className="skima-action-row">
          <Button size="sm" variant="outline" onClick={() => openOrder(order)}>
            Open
          </Button>
          {needsDispatchRecovery(order) ? (
            canRecoverDispatch ? (
              <Button
                size="sm"
                variant="outline"
                icon={Route}
                isLoading={retryDispatch.isPending && retryDispatch.variables?.id === order.id}
                disabled={retryDispatch.isPending}
                onClick={() => {
                  setNotice(null);
                  retryDispatch.mutate(order);
                }}
              >
                Retry matching
              </Button>
            ) : <span className="skima-muted">Operations permission required</span>
          ) : null}
        </div>
      ),
    },
  ];

  const loading = orders.isLoading || jobs.isLoading;
  const error = orders.error ?? jobs.error;
  const invalidRoute = controlledRoute?.kind === "invalid";
  const missingOrder = controlledRoute?.kind === "order" && !loading && !error && !selectedOrder;

  return (
    <>
      <PageHeader
        eyebrow="LPG live operations"
        title="Operations"
        description="Monitor real refill orders from the same LPG runtime used by customers, drivers, and stations. Driver assignment remains automatic; recovery is only shown when a funded legacy or interrupted order has no driver."
        actions={(
          <Button
            icon={RefreshCcw}
            variant="outline"
            onClick={() => void Promise.all([orders.refetch(), jobs.refetch()])}
          >
            Refresh live operations
          </Button>
        )}
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Active refills" value={activeCount} icon={Activity} tone="info" />
        <MetricTile
          label="Needs driver recovery"
          value={attentionCount}
          icon={AlertTriangle}
          tone={attentionCount ? "warning" : "success"}
        />
        <MetricTile label="Drivers assigned" value={assignedCount} icon={Truck} tone="success" />
        <MetricTile
          label="Payment reserved"
          value={inEscrowCount}
          icon={WalletCards}
          tone={inEscrowCount ? "info" : "neutral"}
        />
      </section>

      {notice ? (
        <div className={retryDispatch.error ? "admin-notice is-error" : "admin-notice"} role="status">
          {notice}
        </div>
      ) : null}

      {loading ? <LoadingState label="Loading live LPG operations" /> : null}
      {error ? (
        <ErrorState
          title="LPG operations unavailable"
          message={readError(error)}
          onRetry={() => void Promise.all([orders.refetch(), jobs.refetch()])}
        />
      ) : null}

      {!loading && !error && invalidRoute ? (
        <ErrorState
          title="Refill link unavailable"
          message="This refill link is not valid. Open the refill queue to choose an order."
          onRetry={() => props.onNavigate?.("/operations/orders")}
        />
      ) : null}

      {!loading && !error && missingOrder ? (
        <ErrorState
          title="Refill not found"
          message="This refill is no longer available to your account or the link is out of date."
          onRetry={() => props.onNavigate?.("/operations/orders")}
        />
      ) : null}

      {!loading && !error && !invalidRoute && !missingOrder && selectedOrder ? (
        <OrderDetailPanel
          order={selectedOrder}
          job={selectedJob}
          canRecoverDispatch={canRecoverDispatch}
          isRetrying={retryDispatch.isPending}
          onBack={closeOrder}
          onRetry={() => {
            setNotice(null);
            retryDispatch.mutate(selectedOrder);
          }}
        />
      ) : null}

      {!loading && !error && !invalidRoute && !missingOrder && !selectedOrder ? (
        <>
          <section className="sk-panel">
            <div className="sk-panel__header">
              <div>
                <h2>Automatic dispatch is primary</h2>
                <p className="skima-muted">
                  SKIMA chooses eligible drivers using live location, coverage, verification, vehicle eligibility, workload, distance and dispatch policy. Admin recovery never bypasses those checks.
                </p>
              </div>
              <StatusBadge tone={attentionCount ? "warning" : "success"}>
                {attentionCount
                  ? `${attentionCount} refill${attentionCount === 1 ? "" : "s"} need attention`
                  : "Dispatch healthy"}
              </StatusBadge>
            </div>
            {attentionCount ? (
              <div className="admin-inline-warning">
                Use <strong>Retry driver matching</strong> only for a funded order left without a driver. If no eligible driver is available, SKIMA will keep the order unassigned rather than force an unsafe assignment.
              </div>
            ) : null}
          </section>

          <section className="sk-panel">
            <div className="sk-panel__header">
              <div>
                <h2>Refill queue</h2>
                <p className="skima-muted">
                  Human-readable station, driver, payment and fee information from the canonical LPG order and job APIs.
                </p>
              </div>
              <div style={{ minWidth: 190 }}>
                <SelectInput
                  label="Show"
                  value={filter}
                  onChange={(event) => setFilter(event.currentTarget.value as QueueFilter)}
                  options={[
                    { label: "Active refills", value: "active" },
                    { label: "Needs driver recovery", value: "attention" },
                    { label: "Completed", value: "completed" },
                    { label: "All orders", value: "all" },
                  ]}
                />
              </div>
            </div>
            <DataTable
              caption="SKIMA LPG refill operations"
              columns={columns}
              records={visibleOrders}
              getRowKey={(order) => order.id}
              emptyTitle={filter === "attention" ? "No driver recovery needed" : "No refill orders in this view"}
              emptyMessage={filter === "attention"
                ? "Automatic dispatch has assigned drivers to all funded active refills."
                : "Orders will appear here as customers create LPG refills."}
            />
          </section>

          <section className="skima-grid">
            <div className="sk-panel">
              <div className="sk-panel__header">
                <div>
                  <h2>Location & station context</h2>
                  <p className="skima-muted">
                    Operations uses saved station addresses from the LPG job runtime rather than displaying latitude/longitude as operator labels.
                  </p>
                </div>
                <MapPin size={20} />
              </div>
            </div>
            <div className="sk-panel">
              <div className="sk-panel__header">
                <div>
                  <h2>Eligibility protected</h2>
                  <p className="skima-muted">
                    Recovery calls the canonical dispatch engine. An administrator cannot assign an unverified, out-of-area, stale-location or ineligible driver from this screen.
                  </p>
                </div>
                <ShieldCheck size={20} />
              </div>
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}

function OrderDetailPanel(props: {
  readonly order: LpgOrder;
  readonly job: LpgJob | null;
  readonly canRecoverDispatch: boolean;
  readonly isRetrying: boolean;
  readonly onBack: () => void;
  readonly onRetry: () => void;
}) {
  const order = props.order;
  const job = props.job;
  const reference = order.public_reference ?? job?.publicReference ?? "Refill";
  const recoveryNeeded = needsDispatchRecovery(order);

  return (
    <section className="sk-panel">
      <div className="sk-panel__header">
        <div>
          <Button icon={ArrowLeft} variant="ghost" size="sm" onClick={props.onBack}>
            Back to refill queue
          </Button>
          <p className="skima-muted" style={{ marginBottom: 4, marginTop: 10 }}>Refill record</p>
          <h2 style={{ margin: 0 }}>{reference}</h2>
        </div>
        <StatusBadge tone={statusTone(order.status)}>{normalizeStatusLabel(order.status)}</StatusBadge>
      </div>

      <div className="admin-layer-grid">
        <div className="admin-setting-section">
          <h3>Order & cylinder</h3>
          <DetailList
            items={[
              { label: "Requested LPG", value: `${order.requested_kg.toFixed(1)} kg` },
              {
                label: "Cylinder",
                value: job?.cylinderReference ?? job?.cylinderIdentifier ?? "Cylinder reference unavailable",
              },
              {
                label: "Cylinder size",
                value: job?.cylinderSizeKg != null ? `${job.cylinderSizeKg.toFixed(1)} kg` : "Not recorded",
              },
              {
                label: "Actual LPG filled",
                value: job?.actualKg != null ? `${job.actualKg.toFixed(1)} kg` : "Not recorded yet",
              },
              { label: "Created", value: formatDate(order.created_at) },
              { label: "Last updated", value: formatDate(order.updated_at) },
            ]}
          />
        </div>

        <div className="admin-setting-section">
          <h3>Station & driver</h3>
          <DetailList
            items={[
              { label: "Station", value: job?.stationDisplayName ?? "Station pending" },
              { label: "Station address", value: job?.stationAddress ?? "Address not available" },
              { label: "Driver", value: job?.driverDisplayName ?? "Not assigned" },
              { label: "Driver reference", value: job?.driverReference ?? "Not assigned" },
              {
                label: "Driver verification",
                value: job?.driverVerificationStatus
                  ? normalizeStatusLabel(job.driverVerificationStatus)
                  : "Not available",
              },
              { label: "Assignment", value: normalizeStatusLabel(order.assignment_status) },
            ]}
          />
        </div>

        <div className="admin-setting-section">
          <h3>Payment & settlement</h3>
          <DetailList
            items={[
              { label: "Customer total", value: money(order.total_amount, order.currency_code) },
              { label: "Station share", value: money(order.station_amount ?? 0, order.currency_code) },
              { label: "Delivery fee", value: money(order.delivery_fee_amount ?? 0, order.currency_code) },
              { label: "SKIMA fee", value: money(order.platform_fee_amount ?? 0, order.currency_code) },
              { label: "Driver commission", value: money(order.driver_commission_amount ?? 0, order.currency_code) },
              { label: "Payment", value: normalizeStatusLabel(order.payment_status) },
            ]}
          />
        </div>

        <div className="admin-setting-section">
          <h3>Dispatch protection</h3>
          <p>
            Driver assignment remains automatic and eligibility-driven. Recovery re-runs the canonical matching engine; it never manually assigns an ineligible driver.
          </p>
          {recoveryNeeded ? (
            props.canRecoverDispatch ? (
              <Button
                icon={Route}
                variant="outline"
                isLoading={props.isRetrying}
                disabled={props.isRetrying}
                onClick={props.onRetry}
              >
                Retry driver matching
              </Button>
            ) : (
              <StatusBadge tone="warning">Operations permission required for recovery</StatusBadge>
            )
          ) : (
            <StatusBadge tone={order.driver_profile_id ? "success" : "neutral"}>
              {order.driver_profile_id ? "Automatic assignment active" : "No recovery action needed"}
            </StatusBadge>
          )}
        </div>
      </div>
    </section>
  );
}

function orderRecordReference(order: LpgOrder, job: LpgJob | undefined): string {
  return order.public_reference ?? job?.publicReference ?? order.id;
}

function needsDispatchRecovery(order: LpgOrder): boolean {
  return Boolean(
    !order.driver_profile_id &&
    RECOVERY_STATUSES.has(order.status) &&
    ["reserved", "held", "payment_reserved"].includes(order.payment_status),
  );
}

function money(amount: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: currencyCode || "NGN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function shortId(value: string | null | undefined): string {
  if (!value) return "Not available";
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (["completed", "delivered", "station_settled", "refill_confirmed"].includes(status)) return "success";
  if (["cancelled", "refunded", "failed", "disputed"].includes(status)) return "danger";
  if (["matching_station", "matching_driver", "driver_offered", "payment_reserved"].includes(status)) return "warning";
  return "info";
}

function readError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "details", "hint", "code"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return "SKIMA could not load live LPG operations. Refresh the page or check the LPG gateway deployment.";
}
