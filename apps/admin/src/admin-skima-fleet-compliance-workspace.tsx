import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileCheck2, RefreshCcw, ShieldCheck, Upload, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { createClientIdempotencyKey } from "@skima/frontend-core";
import {
  Button,
  Dialog,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  SelectInput,
  StatusBadge,
  TextAreaInput,
  TextInput,
} from "@skima/ui";

import { useSessionState } from "./session";

const VehicleSchema = z.object({
  vehicleId: z.string().uuid(),
  registrationNumber: z.string().nullable(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  status: z.string(),
  complianceReady: z.boolean(),
  currentDriverName: z.string().nullable(),
  currentDriverPublicId: z.string().nullable(),
});
const VehicleListSchema = z.array(VehicleSchema.passthrough());
type FleetVehicle = z.infer<typeof VehicleSchema>;

const ComplianceSchema = z.object({
  requirementKey: z.string(),
  label: z.string(),
  documentPurposeKey: z.string(),
  moduleKey: z.string().nullable(),
  required: z.boolean(),
  enforcement: z.string(),
  status: z.string(),
  evidenceId: z.string().uuid().nullable(),
  documentSubmissionId: z.string().uuid().nullable(),
  validFrom: z.string().nullable(),
  validUntil: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  current: z.boolean(),
});
const ComplianceListSchema = z.array(ComplianceSchema);
type ComplianceRequirement = z.infer<typeof ComplianceSchema>;

type UploadState = {
  requirement: ComplianceRequirement;
  file: File | null;
  validFrom: string;
  validUntil: string;
  reason: string;
};

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const ALLOWED_DOCUMENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export function AdminSkimaFleetComplianceWorkspace(props: { readonly onNavigate: (href: string) => void }) {
  const { supabase, status, context } = useSessionState();
  const queryClient = useQueryClient();
  const [vehicleId, setVehicleId] = useState("");
  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isSuperAdmin = context?.platformAdmin?.admin_kind === "super_admin";
  const canManageCompliance = Boolean(
    isSuperAdmin ||
      context?.permissions.includes("platform.fleets.manage") ||
      context?.permissions.includes("platform.fleets.review") ||
      context?.permissions.includes("platform.vehicles.manage"),
  );

  const vehicles = useQuery({
    queryKey: ["platform-fleet-vehicles"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_platform_fleet_vehicle_options");
      if (error) throw error;
      return VehicleListSchema.parse(data ?? []);
    },
  });

  const fleet = vehicles.data ?? [];
  useEffect(() => {
    if (vehicleId && fleet.some((vehicle) => vehicle.vehicleId === vehicleId)) return;
    setVehicleId(fleet[0]?.vehicleId ?? "");
  }, [fleet, vehicleId]);

  const selectedVehicle = fleet.find((vehicle) => vehicle.vehicleId === vehicleId) ?? null;

  const compliance = useQuery({
    queryKey: ["platform-fleet-vehicle-compliance", vehicleId],
    enabled: status === "authenticated" && Boolean(vehicleId),
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_platform_fleet_vehicle_compliance", {
        target_vehicle_id: vehicleId,
      });
      if (error) throw error;
      return ComplianceListSchema.parse(data ?? []);
    },
  });

  const requirements = compliance.data ?? [];
  const completeCount = requirements.filter((requirement) => requirement.current).length;
  const missingCount = requirements.filter((requirement) => !requirement.current).length;
  const expiryCount = useMemo(() => requirements.filter((requirement) => {
    if (!requirement.validUntil || !requirement.current) return false;
    const expiry = new Date(`${requirement.validUntil}T23:59:59`);
    const soon = new Date();
    soon.setDate(soon.getDate() + 30);
    return expiry <= soon;
  }).length, [requirements]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["platform-fleet-vehicles"] }),
      queryClient.invalidateQueries({ queryKey: ["platform-fleet-vehicle-compliance"] }),
      queryClient.invalidateQueries({ queryKey: ["lpg-managed-drivers-admin"] }),
      queryClient.invalidateQueries({ queryKey: ["lpg-launch-assurance-readiness"] }),
    ]);
  };

  const uploadEvidence = useMutation({
    mutationFn: async (state: UploadState) => {
      if (!selectedVehicle) throw new Error("Choose a SKIMA vehicle.");
      if (!state.file) throw new Error("Choose the document or image to upload.");
      if (!ALLOWED_DOCUMENT_TYPES.has(state.file.type)) throw new Error("Use PDF, JPEG, PNG or WebP for vehicle compliance evidence.");
      if (state.file.size <= 0 || state.file.size > MAX_DOCUMENT_BYTES) throw new Error("Vehicle compliance documents must be no larger than 20 MB.");
      if (!state.reason.trim()) throw new Error("Enter a short admin note for this evidence.");
      if (state.validFrom && state.validUntil && state.validUntil < state.validFrom) throw new Error("Expiry cannot be before the valid-from date.");

      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const user = userResult.user;
      if (!user) throw new Error("Your admin session is no longer available.");

      const safeName = sanitizeFileName(state.file.name || "vehicle-document");
      const uploadId = crypto.randomUUID();
      const storagePath = `${user.id}/platform-fleet/${selectedVehicle.vehicleId}/${state.requirement.requirementKey}/${uploadId}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("skima-platform-documents")
        .upload(storagePath, state.file, { contentType: state.file.type, upsert: false });
      if (uploadError) throw uploadError;

      const idempotencyKey = createClientIdempotencyKey(
        "admin.skima-fleet.compliance",
        `${selectedVehicle.vehicleId}:${state.requirement.requirementKey}:${uploadId}`,
      );

      const { data, error } = await supabase.rpc("record_platform_fleet_compliance_document", {
        target_byte_size: state.file.size,
        target_checksum: null,
        target_content_type: state.file.type,
        target_idempotency_key: idempotencyKey,
        target_metadata: {
          originalFileName: state.file.name,
          surface: "skima_fleet_compliance",
        },
        target_reason: state.reason.trim(),
        target_requirement_key: state.requirement.requirementKey,
        target_storage_path: storagePath,
        target_valid_from: state.validFrom || null,
        target_valid_until: state.validUntil || null,
        target_vehicle_id: selectedVehicle.vehicleId,
      });

      if (error) {
        await supabase.storage.from("skima-platform-documents").remove([storagePath]);
        throw error;
      }
      return z.string().uuid().parse(data);
    },
    onSuccess: async (_submissionId, state) => {
      setNotice(`${state.requirement.label} saved for ${vehicleLabel(selectedVehicle)}.`);
      setUploadState(null);
      await refresh();
    },
  });

  if (vehicles.isPending) return <LoadingState label="Loading SKIMA fleet compliance…" />;
  if (vehicles.error) return <ErrorState error={vehicles.error} onRetry={() => void refresh()} />;

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="People & Partners · SKIMA Fleet"
        title="Vehicle Compliance"
        description="Upload and maintain the company documents that make a SKIMA-owned vehicle eligible for LPG operations. These records belong to the SKIMA asset, not to the Driver assigned to it."
        actions={(
          <div className="sk-inline-actions">
            <Button variant="outline" icon={ArrowLeft} onClick={() => props.onNavigate("/partners/fleet")}>Back to SKIMA Fleet</Button>
            <Button variant="ghost" icon={Wrench} onClick={() => props.onNavigate("/partners/fleet/legacy")}>Advanced records</Button>
            <Button variant="outline" icon={RefreshCcw} onClick={() => void refresh()}>Refresh</Button>
          </div>
        )}
      />

      {notice ? <div className="sk-panel"><StatusBadge tone="success">{notice}</StatusBadge></div> : null}

      {!fleet.length ? (
        <section className="sk-panel stack-md">
          <h2>No SKIMA vehicles yet</h2>
          <p className="skima-muted">Register a company-owned vehicle first, then return here to upload its compliance evidence.</p>
          <Button icon={ArrowLeft} onClick={() => props.onNavigate("/partners/fleet")}>Open SKIMA Fleet</Button>
        </section>
      ) : (
        <>
          <section className="sk-panel stack-md">
            <SelectInput
              label="SKIMA vehicle"
              value={vehicleId}
              onChange={(event) => setVehicleId(event.currentTarget.value)}
              options={fleet.map((vehicle) => ({ label: vehicleLabel(vehicle), value: vehicle.vehicleId }))}
            />
            {selectedVehicle ? (
              <div className="skima-list-row">
                <div>
                  <strong>{vehicleLabel(selectedVehicle)}</strong>
                  <span>{selectedVehicle.currentDriverName ? `Assigned to ${selectedVehicle.currentDriverName}` : "Not assigned to a Driver"}</span>
                </div>
                <StatusBadge tone={selectedVehicle.complianceReady ? "success" : "warning"}>
                  {selectedVehicle.complianceReady ? "Compliance complete" : "Compliance incomplete"}
                </StatusBadge>
              </div>
            ) : null}
          </section>

          <section className="skima-grid skima-grid--compact">
            <MetricTile label="Requirements" value={requirements.length} icon={FileCheck2} />
            <MetricTile label="Current evidence" value={completeCount} icon={ShieldCheck} tone={completeCount === requirements.length && requirements.length ? "success" : "neutral"} />
            <MetricTile label="Need evidence" value={missingCount} icon={Upload} tone={missingCount ? "warning" : "success"} />
            <MetricTile label="Expire within 30 days" value={expiryCount} icon={RefreshCcw} tone={expiryCount ? "warning" : "neutral"} />
          </section>

          <section className="sk-panel stack-md">
            <div className="section-heading">
              <div>
                <span className="section-kicker">Required documents</span>
                <h2>Vehicle evidence</h2>
                <p className="skima-muted">Replacing a document preserves the old record for audit and makes the new approved evidence authoritative.</p>
              </div>
            </div>

            {compliance.isPending ? <LoadingState label="Loading vehicle requirements…" /> : null}
            {compliance.error ? <ErrorState error={compliance.error} onRetry={() => void compliance.refetch()} /> : null}
            {!compliance.isPending && !compliance.error ? requirements.map((requirement) => (
              <div className="sk-panel" key={requirement.requirementKey}>
                <div className="skima-list-row">
                  <div>
                    <strong>{requirement.label}</strong>
                    <span>{requirement.moduleKey === "lpg" ? "Required for LPG dispatch" : "Required for vehicle dispatch"}</span>
                    {requirement.validUntil ? <small>Valid until {formatDate(requirement.validUntil)}</small> : null}
                  </div>
                  <div style={{ display: "flex", gap: ".5rem", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <StatusBadge tone={requirement.current ? "success" : "warning"}>{requirement.current ? "Current" : requirement.status === "missing" ? "Missing" : "Needs replacement"}</StatusBadge>
                    <Button
                      size="sm"
                      variant={requirement.current ? "outline" : "primary"}
                      icon={Upload}
                      disabled={!canManageCompliance}
                      onClick={() => setUploadState({ requirement, file: null, validFrom: new Date().toISOString().slice(0, 10), validUntil: requirement.validUntil ?? "", reason: "" })}
                    >
                      {requirement.current ? "Replace evidence" : "Upload evidence"}
                    </Button>
                  </div>
                </div>
              </div>
            )) : null}
          </section>
        </>
      )}

      <Dialog
        isOpen={Boolean(uploadState)}
        title={uploadState ? `Upload ${uploadState.requirement.label}` : "Upload vehicle evidence"}
        onClose={() => { if (!uploadEvidence.isPending) setUploadState(null); }}
        footer={(
          <>
            <Button variant="secondary" disabled={uploadEvidence.isPending} onClick={() => setUploadState(null)}>Cancel</Button>
            <Button isLoading={uploadEvidence.isPending} disabled={!uploadState?.file || !uploadState?.reason.trim()} onClick={() => uploadState && uploadEvidence.mutate(uploadState)}>Save evidence</Button>
          </>
        )}
      >
        {uploadState ? (
          <div className="stack-md">
            <p className="skima-muted">Accepted: PDF, JPEG, PNG or WebP. Maximum 20 MB. This is protected internal company evidence.</p>
            <label className="sk-field">
              <span className="sk-field__label">Document or image</span>
              <input
                className="sk-input"
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(event) => setUploadState((current) => current ? { ...current, file: event.currentTarget.files?.[0] ?? null } : current)}
              />
            </label>
            <div className="skima-form-grid">
              <TextInput label="Valid from (optional)" type="date" value={uploadState.validFrom} onChange={(event) => setUploadState((current) => current ? { ...current, validFrom: event.currentTarget.value } : current)} />
              <TextInput label="Expiry date (optional)" type="date" value={uploadState.validUntil} onChange={(event) => setUploadState((current) => current ? { ...current, validUntil: event.currentTarget.value } : current)} />
            </div>
            <TextAreaInput label="Admin review note" value={uploadState.reason} onChange={(event) => setUploadState((current) => current ? { ...current, reason: event.currentTarget.value } : current)} placeholder="Example: Verified current insurance certificate against company fleet records" />
            {uploadEvidence.error ? <ErrorState error={uploadEvidence.error} /> : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

function vehicleLabel(vehicle: FleetVehicle | null) {
  if (!vehicle) return "SKIMA vehicle";
  const details = `${vehicle.manufacturer ?? "Vehicle"} ${vehicle.model ?? ""}`.trim();
  return vehicle.registrationNumber ? `${vehicle.registrationNumber} · ${details}` : details;
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-100) || "vehicle-document";
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}
