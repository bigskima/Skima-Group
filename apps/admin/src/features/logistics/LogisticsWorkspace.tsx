import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClientIdempotencyKey } from "@skima/frontend-core";
import { z } from "zod";

import { useSessionState } from "../../session";
import { AdminV2PageHeader } from "../../shared/patterns/AdminV2Patterns";

import "./logistics-workspace.css";

type Row = Record<string, unknown>;
type DisputeDecision =
  | "refund_customer"
  | "allow_delivery_confirmation"
  | "resume_delivery"
  | "offline_finance_review"
  | "close_offline_finance_review";

const RecordSchema = z.record(z.string(), z.unknown());
const RecordArraySchema = z.array(RecordSchema);
const UuidSchema = z.string().uuid();

function read(row: Row | null | undefined, key: string, fallback = "—"): string {
  const value = row?.[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function nested(row: Row | null | undefined, key: string): Row | null {
  const value = row?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function label(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateLabel(value: unknown): string {
  if (typeof value !== "string") return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function Status({ value }: { readonly value: string }) {
  const tone = ["active", "verified", "completed", "delivered", "resolved"].includes(value)
    ? "success"
    : ["pending", "open", "under_review", "in_progress", "recovery_pending", "incident_hold"].includes(value)
      ? "warning"
      : ["rejected", "suspended", "failed_delivery", "cancelled", "escalated", "unknown"].includes(value)
        ? "danger"
        : "neutral";
  return <span className={"logistics-admin__status logistics-admin__status--" + tone}>{label(value || "unknown")}</span>;
}

function Metric({ title, value, detail }: { title: string; value: string | number; detail: string }) {
  return (
    <article className="logistics-admin__metric">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="logistics-admin__empty">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function TableFrame(props: {
  readonly headers: readonly string[];
  readonly children: ReactNode;
}) {
  return (
    <div className="logistics-admin__table-wrap">
      <table className="logistics-admin__table">
        <thead><tr>{props.headers.map((item) => <th key={item}>{item}</th>)}</tr></thead>
        <tbody>{props.children}</tbody>
      </table>
    </div>
  );
}

export function LogisticsWorkspace(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
}) {
  const session = useSessionState();
  const { api, status, context } = session;
  const queryClient = useQueryClient();
  const permissions = context?.permissions ?? [];
  const isSuperAdmin = context?.platformAdmin?.admin_kind === "super_admin";
  const canRead = isSuperAdmin || permissions.includes("logistics.marketplace.read") || permissions.includes("logistics.marketplace.manage");
  const canManage = isSuperAdmin || permissions.includes("logistics.marketplace.manage");
  const canResolveFinance = isSuperAdmin || permissions.includes("platform.escrow.execute");
  const enabled = status === "authenticated" && canRead;

  const providers = useQuery({
    queryKey: ["logistics-admin", "providers"],
    enabled,
    staleTime: 30_000,
    queryFn: () => api.get("/runtime/logistics/company", RecordArraySchema),
  });
  const categories = useQuery({
    queryKey: ["logistics-admin", "categories"],
    enabled,
    staleTime: 30_000,
    queryFn: () => api.get("/runtime/logistics/categories", RecordArraySchema),
  });
  const bookings = useQuery({
    queryKey: ["logistics-admin", "bookings"],
    enabled,
    staleTime: 15_000,
    queryFn: () => api.get("/runtime/logistics/bookings", RecordArraySchema),
  });
  const incidents = useQuery({
    queryKey: ["logistics-admin", "incidents"],
    enabled,
    staleTime: 15_000,
    queryFn: () => api.get("/runtime/logistics/bookings/incidents", RecordArraySchema),
  });
  const disputes = useQuery({
    queryKey: ["logistics-admin", "disputes"],
    enabled,
    staleTime: 15_000,
    queryFn: () => api.get("/runtime/logistics/bookings/disputes", RecordArraySchema),
  });

  const [reviewReason, setReviewReason] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [categoryKey, setCategoryKey] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [parentKey, setParentKey] = useState("");
  const [sortOrder, setSortOrder] = useState("100");
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    disputeId: string;
    decision: DisputeDecision;
    title: string;
    message: string;
  } | null>(null);

  const providerRows = useMemo(() => providers.data ?? [], [providers.data]);
  const categoryRows = useMemo(() => categories.data ?? [], [categories.data]);
  const bookingRows = useMemo(() => bookings.data ?? [], [bookings.data]);
  const incidentRows = useMemo(() => incidents.data ?? [], [incidents.data]);
  const disputeRows = useMemo(() => disputes.data ?? [], [disputes.data]);
  const pendingProviders = providerRows.filter((item) => read(item, "verification_status", "") === "pending");
  const verifiedProviders = providerRows.filter((item) => read(item, "verification_status", "") === "verified");
  const activeDisputes = disputeRows.filter((item) =>
    ["open", "under_review", "escalated"].includes(read(item, "status", "")));
  const openIncidents = incidentRows.filter((item) =>
    ["open", "under_review", "recovery_pending", "escalated"].includes(read(item, "status", "")));

  const refresh = async () => {
    await Promise.all([
      providers.refetch(),
      categories.refetch(),
      bookings.refetch(),
      incidents.refetch(),
      disputes.refetch(),
    ]);
  };
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["logistics-admin"] });
  };

  const verifyProvider = useMutation({
    mutationFn: async (input: { organizationId: string; decision: "verified" | "rejected" }) => {
      if (!canManage) throw new Error("Logistics marketplace management permission is required.");
      if (reviewReason.trim().length < 5) throw new Error("Enter a review reason of at least five characters.");
      return api.post("/runtime/logistics/admin/providers/verification", {
        organizationId: input.organizationId,
        decision: input.decision,
        reason: reviewReason.trim(),
        idempotencyKey: createClientIdempotencyKey(
          "logistics.admin.provider.verification",
          input.organizationId + ":" + input.decision + ":" + reviewReason.trim(),
        ),
      }, UuidSchema);
    },
    onSuccess: async (_result, input) => {
      setReviewReason("");
      setFormError(null);
      setNotice(input.decision === "verified"
        ? "Provider verified and made eligible for Logistics matching."
        : "Provider application rejected and recorded.");
      await invalidate();
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : "Provider verification could not be saved."),
  });

  const changeProviderStatus = useMutation({
    mutationFn: async (input: { organizationId: string; status: "active" | "paused" | "closed" }) => {
      if (!canManage) throw new Error("Logistics marketplace management permission is required.");
      if (reviewReason.trim().length < 3) throw new Error("Enter a reason of at least three characters.");
      return api.post("/runtime/logistics/company/status", {
        organizationId: input.organizationId,
        status: input.status,
        reason: reviewReason.trim(),
        idempotencyKey: createClientIdempotencyKey(
          "logistics.admin.provider.operational-status",
          input.organizationId + ":" + input.status + ":" + reviewReason.trim(),
        ),
      }, UuidSchema);
    },
    onSuccess: async (_result, input) => {
      setReviewReason("");
      setFormError(null);
      setNotice("Provider operating status changed to " + label(input.status) + ".");
      await invalidate();
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : "Provider operating status could not be changed."),
  });

  const saveCategory = useMutation({
    mutationFn: async (input: {
      key: string;
      name: string;
      description: string | null;
      parent: string | null;
      sort: number;
      status: "active" | "suspended";
    }) => {
      if (!canManage) throw new Error("Logistics marketplace management permission is required.");
      return api.post("/runtime/logistics/admin/categories", {
        key: input.key,
        displayName: input.name,
        description: input.description,
        parentKey: input.parent,
        status: input.status,
        sortOrder: input.sort,
        metadata: { source: "skima.logistics.admin.web" },
      }, UuidSchema);
    },
    onSuccess: async () => {
      setCategoryKey("");
      setCategoryName("");
      setCategoryDescription("");
      setParentKey("");
      setSortOrder("100");
      setFormError(null);
      setNotice("Logistics service category saved.");
      await invalidate();
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : "The service category could not be saved."),
  });

  const resolveDispute = useMutation({
    mutationFn: async (input: { disputeId: string; decision: DisputeDecision }) => {
      if (!canResolveFinance) throw new Error("Platform escrow execution permission is required.");
      if (resolutionNote.trim().length < 5) throw new Error("Enter a resolution note of at least five characters.");
      return api.post("/runtime/logistics/bookings/disputes/resolve", {
        disputeId: input.disputeId,
        decision: input.decision,
        resolutionNote: resolutionNote.trim(),
        idempotencyKey: createClientIdempotencyKey(
          "logistics.admin.dispute.resolve",
          input.disputeId + ":" + input.decision + ":" + resolutionNote.trim(),
        ),
      }, RecordSchema);
    },
    onSuccess: async (_result, input) => {
      setResolutionNote("");
      setConfirmation(null);
      setFormError(null);
      setNotice(input.decision === "refund_customer"
        ? "The eligible full escrow refund was posted to the original customer wallet."
        : input.decision === "offline_finance_review"
          ? "The offline payment dispute was referred for manual finance review. No automatic refund was posted."
          : input.decision === "close_offline_finance_review"
            ? "The offline finance review was closed; no payment or refund was posted."
            : "The dispute decision was recorded. Customer confirmation or delivery resumption remains subject to the server's cargo and escrow safeguards.");
      await invalidate();
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : "The dispute decision could not be recorded."),
  });

  const page = props.route === "/logistics/providers" ? "providers"
    : props.route === "/logistics/categories" ? "categories"
      : props.route === "/logistics/bookings" ? "bookings"
        : props.route === "/logistics/incidents" ? "incidents"
          : props.route === "/logistics/disputes" ? "disputes" : "overview";

  if (status === "loading") {
    return <div className="logistics-admin"><div className="logistics-admin__loading">Loading your SKIMA administrator session…</div></div>;
  }
  if (!canRead) {
    return (
      <div className="logistics-admin">
        <AdminV2PageHeader eyebrow="LOGISTICS NETWORK" title="SKIMA Logistics" description="A dedicated workspace inside the existing SKIMA Admin dashboard." />
        <div className="logistics-admin__notice logistics-admin__notice--warning">
          <strong>Logistics administrator access required</strong>
          <p>This workspace is available to platform administrators with Logistics marketplace read or manage permission. Super administrators retain full access.</p>
        </div>
      </div>
    );
  }

  const loading = providers.isPending || categories.isPending || bookings.isPending || incidents.isPending || disputes.isPending;
  const providerError = providers.error ?? categories.error;
  const title = page === "providers" ? "Provider companies"
    : page === "categories" ? "Service categories"
      : page === "bookings" ? "Bookings & dispatch"
        : page === "incidents" ? "Incidents & cargo recovery"
          : page === "disputes" ? "Customer disputes" : "Logistics overview";
  const description = page === "overview"
    ? "Monitor the nationwide marketplace, provider readiness, active bookings, delivery exceptions and financial disputes."
    : page === "providers"
      ? "Verify provider organisations and control whether they can receive Logistics opportunities."
      : page === "categories"
        ? "Maintain the service taxonomy used by customers, matching and provider companies."
        : page === "bookings"
          ? "Inspect customer bookings, fulfilment status, payment mode and driver assignment."
          : page === "incidents"
            ? "Monitor driver-reported delivery exceptions and cargo custody before any recovery or settlement."
            : "Review non-delivery, partial delivery, damage and recipient disputes with escrow-safe decisions.";

  const bookingTable = (rows: Row[]) => (
    <TableFrame headers={["Booking", "Service", "Status", "Cargo custody", "Payment", "Customer charge", "Created"]}>
      {rows.length === 0 ? <tr><td colSpan={7}><Empty title="No Logistics bookings yet" detail="Customer bookings will appear here after a provider offer is accepted." /></td></tr> : rows.map((booking) => {
        const job = nested(booking, "job");
        return (
          <tr key={read(booking, "id")}>
            <td><strong>{read(booking, "id").slice(0, 8).toUpperCase()}</strong><small>{read(booking, "provider_organization_id", "Provider not assigned").slice(0, 16)}</small></td>
            <td>{read(job, "title", "Logistics delivery")}</td>
            <td><Status value={read(booking, "status", "unknown")} /></td>
            <td><Status value={read(booking, "cargo_custody_status", "not_collected")} /></td>
            <td>{label(read(booking, "payment_mode", "unknown"))}</td>
            <td>{read(booking, "currency_code", "")} {read(booking, "total_customer_charge", "—")}</td>
            <td>{dateLabel(booking.created_at)}</td>
          </tr>
        );
      })}
    </TableFrame>
  );

  return (
    <div className="logistics-admin">
      <AdminV2PageHeader
        eyebrow="LOGISTICS NETWORK"
        title={title}
        description={description}
        actions={
          <button type="button" className="logistics-admin__button logistics-admin__button--quiet" onClick={() => void refresh()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      <div className="logistics-admin__metrics">
        <Metric title="Provider companies" value={providerRows.length} detail={pendingProviders.length + " awaiting verification"} />
        <Metric title="Service categories" value={categoryRows.length} detail={categoryRows.filter((row) => read(row, "status") === "active").length + " active"} />
        <Metric title="Customer bookings" value={bookingRows.length} detail={bookingRows.filter((row) => !["completed", "cancelled"].includes(read(row, "status", ""))).length + " still open"} />
        <Metric title="Open incidents" value={openIncidents.length} detail="Cargo custody needs monitoring" />
        <Metric title="Active disputes" value={activeDisputes.length} detail="Settlement remains protected" />
      </div>

      {formError ? <div className="logistics-admin__notice logistics-admin__notice--error" role="alert">{formError}</div> : null}
      {notice ? <div className="logistics-admin__notice logistics-admin__notice--success" role="status">{notice}</div> : null}

      {loading ? <div className="logistics-admin__loading">Loading Logistics records…</div> : null}
      {providerError && page !== "disputes" ? (
        <div className="logistics-admin__notice logistics-admin__notice--error">
          Provider or category data could not be loaded. Check the runtime deployment and your Logistics read permission.
          <button type="button" onClick={() => void refresh()}>Retry</button>
        </div>
      ) : null}

      {!loading && page === "overview" ? (
        <div className="logistics-admin__grid">
          <section className="logistics-admin__panel">
            <div className="logistics-admin__panel-heading"><div><h2>Marketplace readiness</h2><p>Provider verification and live eligibility.</p></div><button type="button" className="logistics-admin__link" onClick={() => props.onNavigate("/logistics/providers")}>Open providers</button></div>
            <div className="logistics-admin__quick-list">
              <div><span>Awaiting review</span><strong>{pendingProviders.length}</strong></div>
              <div><span>Verified providers</span><strong>{verifiedProviders.length}</strong></div>
              <div><span>Active providers</span><strong>{providerRows.filter((row) => read(row, "operational_status") === "active").length}</strong></div>
            </div>
          </section>
          <section className="logistics-admin__panel">
            <div className="logistics-admin__panel-heading"><div><h2>Exception queue</h2><p>Open incidents and customer disputes requiring attention.</p></div></div>
            <div className="logistics-admin__quick-list">
              <button type="button" onClick={() => props.onNavigate("/logistics/incidents")}><span>Incidents and cargo recovery</span><strong>{openIncidents.length}</strong></button>
              <button type="button" onClick={() => props.onNavigate("/logistics/disputes")}><span>Customer disputes</span><strong>{activeDisputes.length}</strong></button>
            </div>
          </section>
          <section className="logistics-admin__panel logistics-admin__panel--wide">
            <div className="logistics-admin__panel-heading"><div><h2>Latest customer bookings</h2><p>Recent activity across the Logistics network.</p></div><button type="button" className="logistics-admin__link" onClick={() => props.onNavigate("/logistics/bookings")}>View all bookings</button></div>
            {bookingTable(bookingRows.slice(0, 6))}
          </section>
        </div>
      ) : null}

      {!loading && page === "providers" ? (
        <div className="logistics-admin__panel">
          <div className="logistics-admin__panel-heading">
            <div><h2>Provider review & operating status</h2><p>Verification is separate from pausing an already-verified company.</p></div>
            <button type="button" className="logistics-admin__link" onClick={() => props.onNavigate("/partners/applications")}>
              Review company applications & documents
            </button>
          </div>
          {!canManage ? <div className="logistics-admin__notice logistics-admin__notice--warning">Read-only access. Provider decisions require Logistics marketplace manage permission.</div> : null}
          <label className="logistics-admin__field"><span>Review / status reason</span><textarea value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} placeholder="Record the documents checked, reason for approval or pause, and any follow-up required." /></label>
          {providerRows.length === 0 ? <Empty title="No provider companies found" detail="Provider applications will appear when a logistics company completes onboarding." /> : providerRows.map((provider) => {
            const organizationId = read(provider, "organization_id", "");
            const organization = nested(provider, "organization");
            const name = read(provider, "public_name", read(organization, "display_name", "Logistics provider"));
            const verification = read(provider, "verification_status", "pending");
            const operational = read(provider, "operational_status", "onboarding");
            return (
              <article className="logistics-admin__record" key={organizationId}>
                <div className="logistics-admin__record-main"><strong>{name}</strong><span>{read(organization, "legal_name", "Legal name not supplied")}</span><small>Applied {dateLabel(provider.created_at)} · {read(organization, "slug", "No company slug")}</small>{read(provider, "about", "") ? <p>{read(provider, "about")}</p> : null}</div>
                <div className="logistics-admin__record-status"><Status value={verification} /><Status value={operational} /></div>
                <div className="logistics-admin__actions">
                  {verification === "pending" ? <>
                    <button type="button" className="logistics-admin__button logistics-admin__button--danger" disabled={!canManage || reviewReason.trim().length < 5 || verifyProvider.isPending} onClick={() => verifyProvider.mutate({ organizationId, decision: "rejected" })}>Reject</button>
                    <button type="button" className="logistics-admin__button logistics-admin__button--primary" disabled={!canManage || reviewReason.trim().length < 5 || verifyProvider.isPending} onClick={() => verifyProvider.mutate({ organizationId, decision: "verified" })}>Verify provider</button>
                  </> : verification === "verified" && operational === "active" ? (
                    <button type="button" className="logistics-admin__button" disabled={!canManage || reviewReason.trim().length < 3 || changeProviderStatus.isPending} onClick={() => changeProviderStatus.mutate({ organizationId, status: "paused" })}>Pause provider</button>
                  ) : verification === "verified" && operational === "paused" ? (
                    <button type="button" className="logistics-admin__button logistics-admin__button--primary" disabled={!canManage || reviewReason.trim().length < 3 || changeProviderStatus.isPending} onClick={() => changeProviderStatus.mutate({ organizationId, status: "active" })}>Reactivate provider</button>
                  ) : <span className="logistics-admin__muted">No action available</span>}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {!loading && page === "categories" ? (
        <div className="logistics-admin__grid">
          <section className="logistics-admin__panel">
            <div className="logistics-admin__panel-heading"><div><h2>Add service category</h2><p>Use stable, lowercase keys. Existing customer and provider records are not deleted when a category is paused.</p></div></div>
            <form className="logistics-admin__form" onSubmit={(event) => {
              event.preventDefault();
              const sort = Number(sortOrder);
              if (!canManage) return;
              if (categoryKey.trim().length < 3 || categoryName.trim().length < 2) {
                setFormError("Provide a category key and display name.");
                return;
              }
              if (!Number.isInteger(sort) || sort < 0 || sort > 100000) {
                setFormError("Sort order must be a whole number from 0 to 100000.");
                return;
              }
              setFormError(null);
              saveCategory.mutate({ key: categoryKey.trim(), name: categoryName.trim(), description: categoryDescription.trim() || null, parent: parentKey.trim() || null, sort, status: "active" });
            }}>
              <label className="logistics-admin__field"><span>Category key</span><input required minLength={3} value={categoryKey} onChange={(event) => setCategoryKey(event.target.value.toLowerCase().replace(/\s+/g, ".").replace(/[^a-z0-9_.:-]/g, ""))} placeholder="e.g. courier.parcel" /></label>
              <label className="logistics-admin__field"><span>Display name</span><input required minLength={2} value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="e.g. Courier & parcels" /></label>
              <label className="logistics-admin__field"><span>Description</span><textarea value={categoryDescription} onChange={(event) => setCategoryDescription(event.target.value)} placeholder="What services belong in this category?" /></label>
              <label className="logistics-admin__field"><span>Parent category key (optional)</span><input value={parentKey} onChange={(event) => setParentKey(event.target.value)} placeholder="e.g. transport" /></label>
              <label className="logistics-admin__field"><span>Sort order</span><input type="number" min="0" max="100000" step="1" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} /></label>
              <button type="submit" className="logistics-admin__button logistics-admin__button--primary" disabled={!canManage || saveCategory.isPending}>{saveCategory.isPending ? "Saving…" : "Save category"}</button>
            </form>
          </section>
          <section className="logistics-admin__panel">
            <div className="logistics-admin__panel-heading"><div><h2>Published service catalogue</h2><p>{categoryRows.length} categories, sorted by configured order.</p></div></div>
            {categoryRows.length === 0 ? <Empty title="No categories configured" detail="Add a category to organise Logistics services." /> : categoryRows.map((category) => {
              const key = read(category, "key", "");
              const currentStatus = read(category, "status", "draft");
              const nextStatus = currentStatus === "active" ? "suspended" : "active";
              return (
                <article className="logistics-admin__record" key={key}>
                  <div className="logistics-admin__record-main"><strong>{read(category, "display_name", key)}</strong><span>{key}</span><small>{read(category, "description", "No description")}</small></div>
                  <Status value={currentStatus} />
                  {currentStatus !== "retired" ? <button type="button" className="logistics-admin__button" disabled={!canManage || saveCategory.isPending} onClick={() => saveCategory.mutate({ key, name: read(category, "display_name", key), description: read(category, "description", "") || null, parent: read(category, "parent_key", "") || null, sort: Number(category.sort_order ?? 100), status: nextStatus })}>{nextStatus === "active" ? "Activate" : "Pause"}</button> : null}
                </article>
              );
            })}
          </section>
        </div>
      ) : null}

      {!loading && page === "bookings" ? (
        <section className="logistics-admin__panel">
          <div className="logistics-admin__panel-heading"><div><h2>Network bookings</h2><p>Booking and cargo-custody visibility across all provider companies.</p></div></div>
          {bookingTable(bookingRows)}
        </section>
      ) : null}

      {!loading && page === "incidents" ? (
        <section className="logistics-admin__panel">
          <div className="logistics-admin__panel-heading"><div><h2>Incident and cargo recovery register</h2><p>Incidents are read-only here; provider dispatch must resolve custody through the audited incident and recovery workflow.</p></div></div>
          <TableFrame headers={["Booking", "Incident", "Severity", "Cargo custody", "Status", "Reported"]}>
            {incidentRows.length === 0 ? <tr><td colSpan={6}><Empty title="No incidents recorded" detail="Driver, company and customer reports will appear here." /></td></tr> : incidentRows.map((incident) => (
              <tr key={read(incident, "id")}>
                <td><strong>{read(incident, "booking_id").slice(0, 8).toUpperCase()}</strong><small>{read(incident, "provider_organization_id").slice(0, 16)}</small></td>
                <td>{label(read(incident, "incident_type", "other"))}<small>{read(incident, "description", "")}</small></td>
                <td><Status value={read(incident, "severity", "unknown")} /></td>
                <td><Status value={read(incident, "cargo_custody_status", "unknown")} /></td>
                <td><Status value={read(incident, "status", "open")} /></td>
                <td>{dateLabel(incident.created_at)}</td>
              </tr>
            ))}
          </TableFrame>
        </section>
      ) : null}

      {!loading && page === "disputes" ? (
        <section className="logistics-admin__panel">
          <div className="logistics-admin__panel-heading"><div><h2>Customer dispute review</h2><p>Unresolved disputes block settlement. Refunds are constrained to the original fully-held online escrow.</p></div></div>
          {!canResolveFinance ? <div className="logistics-admin__notice logistics-admin__notice--warning">You can review disputes, but decisions require platform escrow execution permission.</div> : null}
          <label className="logistics-admin__field"><span>Resolution note</span><textarea value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} placeholder="Record the evidence reviewed and why this decision is appropriate." /></label>
          {activeDisputes.length === 0 ? <Empty title="No open Logistics disputes" detail="New delivery disputes will appear here and prevent premature settlement." /> : activeDisputes.map((dispute) => {
            const disputeId = read(dispute, "id", "");
            const disputeStatus = read(dispute, "status", "open");
            const bookingStatus = read(dispute, "booking_status_before_dispute", "");
            const incident = nested(dispute, "incident");
            const incidentStatus = read(incident, "status", "");
            const incidentBookingStatus = read(incident, "booking_status_before_incident", "");
            const incidentResolution = read(incident, "resolution_code", "");
            const custody = read(nested(dispute, "booking"), "cargo_custody_status", "");
            const paymentMode = read(nested(dispute, "metadata"), "payment_mode", "unknown");
            const offline = paymentMode === "offline" || paymentMode.startsWith("offline_");
            const escalated = disputeStatus === "escalated";
            const recoveredDeliverySubmitted = incidentStatus === "resolved" && incidentResolution === "recovered_delivery_submitted" && custody === "delivered";
            const canReview = canResolveFinance && resolutionNote.trim().length >= 5 && !resolveDispute.isPending;
            const actions: Array<{ decision: DisputeDecision; title: string; message: string; label: string }> = [];
            if (offline && !escalated) actions.push({ decision: "offline_finance_review", title: "Escalate offline dispute?", message: "This records a manual finance review. It does not claim that an off-platform payment has been refunded.", label: "Send to finance review" });
            if (offline && escalated) actions.push({ decision: "close_offline_finance_review", title: "Close offline finance review?", message: "This closes the review record only. It does not post a payment or refund.", label: "Close review" });
            if (!offline) actions.push({ decision: "refund_customer", title: "Refund full escrow?", message: "The server allows this only when the original online escrow is fully held, nothing has been released, and cargo custody is safely accounted for.", label: "Refund full escrow" });
            if (!offline && (bookingStatus === "delivered" || (bookingStatus === "delivery_exception" && incidentBookingStatus === "delivered") || recoveredDeliverySubmitted)) {
              actions.push({ decision: "allow_delivery_confirmation", title: "Restore customer confirmation?", message: "Delivery confirmation is restored, but the customer must still confirm receipt before settlement.", label: "Allow customer confirmation" });
            }
            if (!offline && bookingStatus === "delivery_exception" && incidentBookingStatus === "in_progress") {
              actions.push({ decision: "resume_delivery", title: "Resume delivery?", message: "The backend rechecks the incident and cargo custody before resuming the same delivery.", label: "Resume delivery" });
            }
            return (
              <article className="logistics-admin__dispute" key={disputeId}>
                <div className="logistics-admin__record-status"><strong>Booking {read(dispute, "booking_id").slice(0, 8).toUpperCase()}</strong><Status value={disputeStatus} /></div>
                <p><strong>{label(read(dispute, "reason", "other"))}</strong> · {label(paymentMode)}</p>
                <p>{read(dispute, "details", "No details supplied.")}</p>
                <small>Opened {dateLabel(dispute.created_at)} · Before dispute: {label(bookingStatus || "unknown")}</small>
                {read(dispute, "resolution_note", "") ? <small>Previous review: {read(dispute, "resolution_note")}</small> : null}
                {offline ? <div className="logistics-admin__notice logistics-admin__notice--warning">Offline payment has no platform escrow to refund automatically. The actual payment must be checked separately.</div> : <div className="logistics-admin__notice">Online refund actions are limited to the original fully-held escrow and original funding wallet.</div>}
                <div className="logistics-admin__actions">
                  {actions.map((action) => (
                    <button key={action.decision} type="button" className="logistics-admin__button logistics-admin__button--quiet" disabled={!canReview} onClick={() => setConfirmation({ disputeId, decision: action.decision, title: action.title, message: action.message })}>{action.label}</button>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      {confirmation ? (
        <div className="logistics-admin__modal-backdrop" role="presentation">
          <section className="logistics-admin__modal" role="dialog" aria-modal="true" aria-labelledby="logistics-admin-confirm-title">
            <h2 id="logistics-admin-confirm-title">{confirmation.title}</h2>
            <p>{confirmation.message}</p>
            <div className="logistics-admin__actions">
              <button type="button" className="logistics-admin__button logistics-admin__button--quiet" onClick={() => setConfirmation(null)}>Cancel</button>
              <button type="button" className="logistics-admin__button logistics-admin__button--primary" disabled={!canResolveFinance || resolutionNote.trim().length < 5 || resolveDispute.isPending} onClick={() => resolveDispute.mutate({ disputeId: confirmation.disputeId, decision: confirmation.decision })}>{resolveDispute.isPending ? "Saving…" : "Confirm decision"}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
