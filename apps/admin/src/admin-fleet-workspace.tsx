import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, ShieldCheck, Truck, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { createClientIdempotencyKey, normalizeStatusLabel } from "@skima/frontend-core";
import { Button, DataTable, Dialog, ErrorState, LoadingState, MetricTile, PageHeader, SelectInput, StatusBadge, TextAreaInput, TextInput, type TableColumn } from "@skima/ui";
import { useSessionState } from "./session";

const Row = z.record(z.unknown());
const Workspace = z.object({
  partners: z.array(Row), applications: z.array(Row), vehicles: z.array(Row), drivers: z.array(Row),
  assignments: z.array(Row), compliance: z.array(Row), ownership: z.array(Row), audit: z.array(Row),
});
type RowType = z.infer<typeof Row>;
type Tab = "partners" | "applications" | "vehicles" | "assignments" | "compliance" | "ownership" | "audit";
type Decision = { kind: "fleet" | "vehicle"; id: string; action: string; label: string };
type Assignment = { vehicleId: string; driverId: string; relationship: string; reason: string };
const text = (row: RowType, key: string) => typeof row[key] === "string" ? row[key] as string : "";
const tabs: readonly Tab[] = ["partners", "applications", "vehicles", "assignments", "compliance", "ownership", "audit"];
const relationships = ["driver_owned", "business_owned", "fleet_owned", "leased", "rented", "third_party_authorized"];

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
      const result = input.kind === "fleet"
        ? await supabase.rpc("review_fleet_application", { target_application_id: input.id, target_decision: input.action, target_reason: input.reason, target_idempotency_key: idempotency })
        : await supabase.rpc("decide_vehicle_lifecycle", { target_vehicle_id: input.id, target_decision: input.action, target_reason: input.reason, target_idempotency_key: idempotency });
      if (result.error) throw result.error;
    },
    onSuccess: async () => { setDecision(null); setReason(""); await queryClient.invalidateQueries({ queryKey: ["fleet-admin"] }); },
  });
  const assign = useMutation({
    mutationFn: async (input: Assignment) => {
      const result = await supabase.rpc("assign_driver_vehicle", {
        target_driver_profile_id: input.driverId, target_vehicle_id: input.vehicleId,
        target_relationship: input.relationship, target_starts_at: new Date().toISOString(),
        target_metadata: { reason: input.reason, surface: "admin_fleet_workspace" },
      });
      if (result.error) throw result.error;
    },
    onSuccess: async () => { setAssignment(null); await queryClient.invalidateQueries({ queryKey: ["fleet-admin"] }); },
  });

  if (data.isPending) return <LoadingState label="Loading fleet operations" />;
  if (data.error) return <ErrorState title="Fleet workspace unavailable" message={data.error.message} onRetry={() => void data.refetch()} />;
  const workspace = data.data;
  const rows = workspace[tab];
  const columns = useMemo<TableColumn<RowType>[]>(() => [
    { key: "identity", header: "Record", render: (row) => <><strong>{text(row, "display_name") || text(row, "legal_name") || text(row, "registration_number") || text(row, "subject_type") || text(row, "entity_id")}</strong><br /><small>{text(row, "partner_kind") || text(row, "vehicle_id") || text(row, "id")}</small></> },
    { key: "status", header: "Status", render: (row) => { const value = text(row, "verification_status") || text(row, "operational_status") || text(row, "status") || text(row, "to_status") || (row.compliant === true ? "compliant" : "attention_required"); return <StatusBadge tone={["approved", "active", "compliant"].includes(value) ? "success" : value === "suspended" ? "danger" : "neutral"}>{normalizeStatusLabel(value)}</StatusBadge>; } },
    { key: "detail", header: "Details", render: (row) => <span>{text(row, "reason") || text(row, "relationship_role") || `${text(row, "manufacturer")} ${text(row, "model")}`.trim() || "—"}</span> },
    { key: "actions", header: "Actions", render: (row) => tab === "applications" ? <Button size="sm" onClick={() => setDecision({ kind: "fleet", id: text(row, "id"), action: "approved", label: "Review fleet" })}>Review</Button> : tab === "vehicles" ? <span className="sk-inline-actions"><Button size="sm" onClick={() => setDecision({ kind: "vehicle", id: text(row, "id"), action: "approved", label: "Review vehicle" })}>Review</Button><Button size="sm" variant="outline" onClick={() => setAssignment({ vehicleId: text(row, "id"), driverId: workspace.drivers[0] ? text(workspace.drivers[0], "id") : "", relationship: "fleet_owned", reason: "" })}>Assign driver</Button></span> : null },
  ], [tab, workspace.drivers]);

  return <section className="admin-workspace">
    <PageHeader eyebrow="Fleet operations" title="Fleet & Vehicles" description="Govern partners, canonical ownership, vehicles, assignments, configured compliance, and immutable history." />
    <div className="metric-grid"><MetricTile icon={UsersRound} label="Partners" value={workspace.partners.length} /><MetricTile icon={Truck} label="Vehicles" value={workspace.vehicles.length} /><MetricTile icon={ShieldCheck} label="Compliance failures" value={workspace.compliance.filter((row) => row.compliant !== true).length} /><MetricTile icon={History} label="History events" value={workspace.audit.length} /></div>
    <div className="admin-toolbar"><TextInput label="Search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /><SelectInput label="Status" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} options={[{ label: "All statuses", value: "" }, { label: "Submitted", value: "submitted" }, { label: "Approved", value: "approved" }, { label: "Suspended", value: "suspended" }, { label: "Rejected", value: "rejected" }]} /></div>
    <div className="admin-tabs">{tabs.map((key) => <Button key={key} variant={tab === key ? "primary" : "secondary"} onClick={() => setTab(key)}>{normalizeStatusLabel(key)}</Button>)}</div>
    <DataTable caption={`Fleet ${tab}`} records={rows} columns={columns} getRowKey={(row) => text(row, "id") || JSON.stringify(row)} emptyMessage={`No ${tab} match the current filters.`} />
    {decision ? <Dialog isOpen title={decision.label} onClose={() => setDecision(null)} footer={<><Button variant="secondary" onClick={() => setDecision(null)}>Cancel</Button><Button disabled={!reason.trim()} isLoading={decide.isPending} onClick={() => decide.mutate({ ...decision, reason })}>Confirm decision</Button></>}><SelectInput label="Decision" value={decision.action} onChange={(event) => setDecision({ ...decision, action: event.currentTarget.value })} options={decision.kind === "fleet" ? [{ label: "Approve", value: "approved" }, { label: "Request correction", value: "correction_required" }, { label: "Reject", value: "rejected" }, { label: "Suspend", value: "suspended" }] : [{ label: "Approve", value: "approved" }, { label: "Reject", value: "rejected" }, { label: "Suspend", value: "suspended" }, { label: "Reinstate", value: "reinstated" }]} /><TextAreaInput label="Reason" value={reason} onChange={(event) => setReason(event.currentTarget.value)} required /></Dialog> : null}
    {assignment ? <Dialog isOpen title="Assign approved driver" onClose={() => setAssignment(null)} footer={<><Button variant="secondary" onClick={() => setAssignment(null)}>Cancel</Button><Button disabled={!assignment.driverId || !assignment.reason.trim()} isLoading={assign.isPending} onClick={() => assign.mutate(assignment)}>Create assignment</Button></>}><SelectInput label="Driver" value={assignment.driverId} onChange={(event) => setAssignment({ ...assignment, driverId: event.currentTarget.value })} options={workspace.drivers.map((driver) => ({ label: text(driver, "public_driver_id") || text(driver, "user_id") || text(driver, "id"), value: text(driver, "id") }))} /><SelectInput label="Relationship" value={assignment.relationship} onChange={(event) => setAssignment({ ...assignment, relationship: event.currentTarget.value })} options={relationships.map((value) => ({ label: normalizeStatusLabel(value), value }))} /><TextAreaInput label="Assignment reason" value={assignment.reason} onChange={(event) => setAssignment({ ...assignment, reason: event.currentTarget.value })} required /></Dialog> : null}
  </section>;
}
