import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, ShieldCheck, Truck, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { createClientIdempotencyKey, normalizeStatusLabel } from "@skima/frontend-core";
import { Button, DataTable, Dialog, ErrorState, LoadingState, MetricTile, PageHeader, SelectInput, StatusBadge, TextAreaInput, TextInput, type TableColumn } from "@skima/ui";
import { useSessionState } from "./session";

const Row = z.record(z.unknown());
const Workspace = z.object({
  partners: z.array(Row), applications: z.array(Row), vehicles: z.array(Row), drivers: z.array(Row).default([]),
  assignments: z.array(Row), compliance: z.array(Row), ownership: z.array(Row), audit: z.array(Row),
  documents: z.array(Row).default([]), serviceLines: z.array(Row).default([]), staff: z.array(Row).default([]),
});
type RowType = z.infer<typeof Row>;
type Tab = "partners" | "applications" | "documents" | "vehicles" | "serviceLines" | "assignments" | "staff" | "compliance" | "ownership" | "audit";
type Decision = { kind: "fleet" | "vehicle" | "document" | "service-line"; id: string; action: string; label: string; vehicleId?: string; serviceKey?: string; subjectType?: string; requirementKey?: string; validFrom?: string; validUntil?: string };
type Assignment = { vehicleId: string; fleetPartnerId: string; driverId: string; serviceKey: string; relationship: string; reason: string };
const text = (row: RowType, key: string) => typeof row[key] === "string" ? row[key] as string : "";
const tabs: readonly Tab[] = ["partners", "applications", "documents", "vehicles", "serviceLines", "assignments", "staff", "compliance", "ownership", "audit"];
const relationships = ["driver_owned", "business_owned", "fleet_owned", "leased", "rented", "third_party_authorized"];
const emptyRows: readonly RowType[] = [];

export function AdminFleetWorkspace() {
  const { supabase, status } = useSessionState();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<Tab>("partners");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [assignment, setAssignment] = useState<Assignment | null>(null);

  const data = useQuery({
    queryKey: ["fleet-admin", search, filter], enabled: status === "authenticated", retry: false,
    queryFn: async () => {
      const result = await supabase.rpc("read_fleet_admin_workspace", { target_search: search.trim() || null, target_status: filter || null });
      if (result.error) throw result.error;
      return Workspace.parse(result.data);
    },
  });
  const decide = useMutation({
    mutationFn: async (input: Decision & { reason: string }) => {
      const idempotency = createClientIdempotencyKey(`admin.${input.kind}.${input.action}`, input.id);
      if (input.kind === "fleet") {
        const result = await supabase.rpc("review_fleet_application", { target_application_id: input.id, target_decision: input.action, target_reason: input.reason, target_idempotency_key: idempotency });
        if (result.error) throw result.error;
        return;
      }
      if (input.kind === "vehicle") {
        const result = await supabase.rpc("decide_vehicle_lifecycle", { target_vehicle_id: input.id, target_decision: input.action, target_reason: input.reason, target_idempotency_key: idempotency });
        if (result.error) throw result.error;
        return;
      }
      if (input.kind === "document") {
        const result = await supabase.rpc("review_fleet_application_document_submission", { target_document_submission_id: input.id, target_decision: input.action, target_reason: input.reason, target_idempotency_key: idempotency });
        if (result.error) throw result.error;
        if (input.action === "approved" && input.subjectType === "vehicle" && input.vehicleId && input.requirementKey) {
          const evidence = await supabase.rpc("record_compliance_evidence", {
            target_requirement_key: input.requirementKey, target_subject_type: "vehicle", target_subject_id: input.vehicleId,
            target_document_submission_id: input.id, target_valid_from: input.validFrom || new Date().toISOString().slice(0, 10),
            target_valid_until: input.validUntil || null, target_reason: input.reason,
            target_idempotency_key: createClientIdempotencyKey("admin.fleet.vehicle-evidence", input.id),
          });
          if (evidence.error) throw evidence.error;
        }
        return;
      }
      if (!input.vehicleId || !input.serviceKey) throw new Error("Vehicle and service line details are required.");
      const result = await supabase.rpc("review_fleet_vehicle_service_line", {
        target_vehicle_id: input.vehicleId, target_service_key: input.serviceKey,
        target_decision: input.action, target_reason: input.reason, target_idempotency_key: idempotency,
      });
      if (result.error) throw result.error;
    },
    onSuccess: async () => { setDecision(null); setReason(""); await queryClient.invalidateQueries({ queryKey: ["fleet-admin"] }); },
  });
  const assign = useMutation({
    mutationFn: async (input: Assignment) => {
      if (!input.fleetPartnerId || !input.serviceKey) throw new Error("Choose an approved fleet service line first.");
      const result = await supabase.rpc("assign_fleet_driver_vehicle", {
        target_fleet_partner_id: input.fleetPartnerId,
        target_driver_profile_id: input.driverId,
        target_vehicle_id: input.vehicleId,
        target_service_key: input.serviceKey,
        target_relationship: input.relationship,
        target_reason: input.reason,
        target_idempotency_key: createClientIdempotencyKey("admin.fleet.driver-assignment", JSON.stringify(input)),
      });
      if (result.error) throw result.error;
    },
    onSuccess: async () => { setAssignment(null); await queryClient.invalidateQueries({ queryKey: ["fleet-admin"] }); },
  });

  const approvedDrivers = data.data?.drivers ?? emptyRows;
  const columns = useMemo<TableColumn<RowType>[]>(() => [
    { key: "identity", header: "Record", render: (row) => <><strong>{text(row, "display_name") || text(row, "legal_name") || text(row, "registration_number") || text(row, "subject_type") || text(row, "entity_id")}</strong><br /><small>{text(row, "partner_kind") || text(row, "vehicle_id") || text(row, "id")}</small></> },
    { key: "status", header: "Status", render: (row) => { const value = text(row, "verification_status") || text(row, "operational_status") || text(row, "status") || text(row, "to_status") || (row.compliant === true ? "compliant" : "attention_required"); return <StatusBadge tone={["approved", "active", "compliant"].includes(value) ? "success" : value === "suspended" ? "danger" : "neutral"}>{normalizeStatusLabel(value)}</StatusBadge>; } },
    { key: "detail", header: "Details", render: (row) => <span>{text(row, "reason") || text(row, "relationship_role") || `${text(row, "manufacturer")} ${text(row, "model")}`.trim() || "—"}</span> },
    { key: "actions", header: "Actions", render: (row) => tab === "applications" ? <Button size="sm" onClick={() => setDecision({ kind: "fleet", id: text(row, "id"), action: "approved", label: "Review fleet application" })}>Review application</Button> : tab === "vehicles" ? <span className="sk-inline-actions"><Button size="sm" onClick={() => setDecision({ kind: "vehicle", id: text(row, "id"), action: "approved", label: "Review vehicle" })}>Review vehicle</Button>{(data.data?.serviceLines ?? []).some((line) => text(line, "vehicle_id") === text(row, "id") && text(line, "status") === "active") ? <Button size="sm" variant="outline" onClick={() => {
      const services = (data.data?.serviceLines ?? []).filter((line) => text(line, "vehicle_id") === text(row, "id") && text(line, "status") === "active");
      setAssignment({ vehicleId: text(row, "id"), fleetPartnerId: text(row, "fleet_partner_id"), driverId: approvedDrivers[0] ? text(approvedDrivers[0], "id") : "", serviceKey: text(services[0], "service_key"), relationship: "fleet_owned", reason: "" });
    }}>Assign driver</Button> : null}</span> : tab === "documents" ? text(row, "status") === "approved" ? <StatusBadge tone="success">Approved</StatusBadge> : <Button size="sm" onClick={() => setDecision({ kind: "document", id: text(row, "documentSubmissionId"), action: "approved", label: "Review fleet document", subjectType: text(row, "subjectType"), vehicleId: text(row, "vehicleId"), requirementKey: text(row, "requirementKey"), validFrom: text(row, "validFrom"), validUntil: text(row, "validUntil") })}>Review document</Button> : tab === "serviceLines" ? <Button size="sm" onClick={() => setDecision({ kind: "service-line", id: text(row, "id"), vehicleId: text(row, "vehicle_id"), serviceKey: text(row, "service_key"), action: "approved", label: "Review service eligibility" })}>Review service</Button> : null },
  ], [approvedDrivers, data.data?.serviceLines, tab]);

  if (data.isPending) return <LoadingState label="Loading fleet operations" />;
  if (data.error) return <ErrorState title="Fleet workspace unavailable" message={data.error.message} onRetry={() => void data.refetch()} />;
  const workspace = data.data;
  const rows = workspace[tab];

  return <section className="admin-workspace">
    <PageHeader eyebrow="People & Partners" title="Fleet Partners" description="Review external fleet-owner applications and evidence, approve vehicles and LPG/Fuel service eligibility, manage authorised staff, and audit partner fleet activity. SKIMA-owned fleet operations remain in their separate workspace." />
    <div className="metric-grid"><MetricTile icon={UsersRound} label="Partners" value={workspace.partners.length} /><MetricTile icon={Truck} label="Vehicles" value={workspace.vehicles.length} /><MetricTile icon={ShieldCheck} label="Compliance issues" value={workspace.compliance.filter((row) => row.compliant !== true).length} /><MetricTile icon={History} label="Recorded changes" value={workspace.audit.length} /></div>
    <div className="admin-toolbar"><TextInput label="Search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /><SelectInput label="Status" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} options={[{ label: "All statuses", value: "" }, { label: "Submitted", value: "submitted" }, { label: "Approved", value: "approved" }, { label: "Suspended", value: "suspended" }, { label: "Rejected", value: "rejected" }]} /></div>
    <div className="admin-tabs">{tabs.map((key) => <Button key={key} variant={tab === key ? "primary" : "secondary"} onClick={() => setTab(key)}>{normalizeStatusLabel(key)}</Button>)}</div>
    <DataTable caption={`Fleet ${tab}`} records={rows} columns={columns} getRowKey={(row) => text(row, "id") || JSON.stringify(row)} emptyMessage={`No ${tab} match the current filters.`} />
    {decision ? <Dialog isOpen title={decision.label} onClose={() => setDecision(null)} footer={<><Button variant="secondary" onClick={() => setDecision(null)}>Cancel</Button><Button disabled={reason.trim().length < 5} isLoading={decide.isPending} onClick={() => decide.mutate({ ...decision, reason })}>Confirm decision</Button></>}><SelectInput label="Decision" value={decision.action} onChange={(event) => setDecision({ ...decision, action: event.currentTarget.value })} options={decision.kind === "fleet" ? [{ label: "Approve", value: "approved" }, { label: "Request correction", value: "correction_required" }, { label: "Reject", value: "rejected" }, { label: "Suspend", value: "suspended" }] : decision.kind === "vehicle" ? [{ label: "Approve", value: "approved" }, { label: "Reject", value: "rejected" }, { label: "Suspend", value: "suspended" }, { label: "Reinstate", value: "reinstated" }] : decision.kind === "document" ? [{ label: "Approve document", value: "approved" }, { label: "Request replacement", value: "correction_required" }, { label: "Reject", value: "rejected" }] : [{ label: "Approve for service", value: "approved" }, { label: "Reject", value: "rejected" }, { label: "Suspend service", value: "suspended" }]} /><TextAreaInput label="Reason (at least five characters)" value={reason} onChange={(event) => setReason(event.currentTarget.value)} required /></Dialog> : null}
    {assignment ? <Dialog isOpen title="Assign approved driver" onClose={() => setAssignment(null)} footer={<><Button variant="secondary" onClick={() => setAssignment(null)}>Cancel</Button><Button disabled={!assignment.driverId || !assignment.serviceKey || !assignment.fleetPartnerId || !assignment.reason.trim()} isLoading={assign.isPending} onClick={() => assign.mutate(assignment)}>Create assignment</Button></>}><SelectInput label="Driver" value={assignment.driverId} onChange={(event) => setAssignment({ ...assignment, driverId: event.currentTarget.value })} options={workspace.drivers.map((driver) => ({ label: text(driver, "public_driver_id") || text(driver, "user_id") || text(driver, "id"), value: text(driver, "id") }))} /><SelectInput label="Approved service line" value={assignment.serviceKey} onChange={(event) => setAssignment({ ...assignment, serviceKey: event.currentTarget.value })} options={workspace.serviceLines.filter((line) => text(line, "vehicle_id") === assignment.vehicleId && text(line, "status") === "active").map((line) => ({ label: normalizeStatusLabel(text(line, "service_key")), value: text(line, "service_key") }))} /><SelectInput label="Vehicle relationship" value={assignment.relationship} onChange={(event) => setAssignment({ ...assignment, relationship: event.currentTarget.value })} options={relationships.filter((value) => value !== "driver_owned" && value !== "business_owned").map((value) => ({ label: normalizeStatusLabel(value), value }))} /><TextAreaInput label="Assignment reason" value={assignment.reason} onChange={(event) => setAssignment({ ...assignment, reason: event.currentTarget.value })} required /></Dialog> : null}
  </section>;
}
