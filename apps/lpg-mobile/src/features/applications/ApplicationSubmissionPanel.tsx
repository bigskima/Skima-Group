import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileCheck2, LoaderCircle, Upload } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useMemo, useRef, useState } from "react";

import { useSession } from "@lpg/app/providers/SessionProvider";
import { uploadRuntimeDocument } from "@lpg/features/media/uploadRuntimeMedia";
import {
  ActionResponseSchema,
  formatStatus,
  getActionResultId,
  getFirstRecordNumber,
  getFirstRecordString,
  getRecordId,
  recordKey,
  statusTone,
  type PlatformRecord,
} from "@lpg/shared/api/records";
import { mutationErrorMessage } from "@lpg/shared/api/useGatewayMutation";
import { StatusChip } from "@lpg/shared/ui/lpgComponents";
import { useDocumentRequirementsQuery, useDocumentsQuery } from "./api";

const editableStatuses = new Set(["additional_info_required", "draft", "incomplete"]);

export function ApplicationSubmissionPanel(props: {
  readonly application: PlatformRecord | null;
  readonly applicationType: PlatformRecord | null;
  readonly children: ReactNode;
  readonly onSubmitted?: (applicationId: string) => void | Promise<void>;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly submitLabel: string;
}) {
  const session = useSession();
  const queryClient = useQueryClient();
  const requirementsQuery = useDocumentRequirementsQuery();
  const documentsQuery = useDocumentsQuery();
  const operationId = useRef(crypto.randomUUID());
  const [files, setFiles] = useState<Readonly<Record<string, File | null>>>({});
  const typeId = getRecordId(props.applicationType);
  const applicationId = getRecordId(props.application);
  const requirementSetId = getFirstRecordString(props.applicationType, [
    "document_requirement_set_id",
    "documentRequirementSetId",
  ]);
  const applicationStatus = getFirstRecordString(props.application, ["status"]) ?? "draft";
  const requirements = useMemo(
    () => (requirementsQuery.data ?? []).filter((requirement) =>
      getFirstRecordString(requirement, ["requirement_set_id", "requirementSetId"]) === requirementSetId &&
      getFirstRecordString(requirement, ["status"]) === "active"
    ),
    [requirementSetId, requirementsQuery.data],
  );
  const documents = useMemo(
    () => (documentsQuery.data ?? []).filter((document) =>
      getFirstRecordString(document, ["application_id", "applicationId"]) === applicationId &&
      getFirstRecordString(document, ["status"]) !== "rejected"
    ),
    [applicationId, documentsQuery.data],
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const typeKey = getFirstRecordString(props.applicationType, ["key"]);
      if (!typeId || !typeKey || !requirementSetId) {
        throw new Error("The backend did not return a complete application type configuration.");
      }

      validateRequiredDocuments(requirements, documents, files);
      let targetApplicationId = applicationId;
      const operationKey = `frontend:lpg-application:${operationId.current}`;

      if (targetApplicationId) {
        await session.api.post(
          "/runtime/applications/payload",
          {
            applicationId: targetApplicationId,
            idempotencyKey: `${operationKey}:payload`,
            payload: props.payload,
          },
          ActionResponseSchema,
        );
      } else {
        const created = await session.api.post(
          "/runtime/applications",
          {
            applicationTypeKey: typeKey,
            idempotencyKey: `${operationKey}:create`,
            payload: props.payload,
          },
          ActionResponseSchema,
        );
        targetApplicationId = getActionResultId(created);
      }

      if (!targetApplicationId) throw new Error("The application service did not return an application identifier.");

      for (const requirement of requirements) {
        const requirementKey = getFirstRecordString(requirement, ["key"]);
        const file = requirementKey ? files[requirementKey] : null;
        if (!requirementKey || !file) continue;

        const uploadKey = `${operationKey}:document:${requirementKey}`;
        const upload = await uploadRuntimeDocument({
          api: session.api,
          file,
          idempotencyKey: uploadKey,
        });
        await session.api.post(
          "/runtime/documents",
          {
            applicationId: targetApplicationId,
            byteSize: file.size,
            contentType: upload.contentType,
            idempotencyKey: `${uploadKey}:register`,
            metadata: { originalFileName: file.name },
            requirementKey,
            storageBucket: upload.storageBucket,
            storagePath: upload.storagePath,
          },
          ActionResponseSchema,
        );
      }

      await session.api.post(
        "/runtime/applications/submit",
        {
          applicationId: targetApplicationId,
          idempotencyKey: `${operationKey}:submit`,
        },
        ActionResponseSchema,
      );
      return targetApplicationId;
    },
    onSuccess: async (targetApplicationId) => {
      await queryClient.invalidateQueries({ queryKey: ["lpg-mobile"] });
      await props.onSubmitted?.(targetApplicationId);
    },
  });

  if (!props.applicationType) {
    return <p className="form-message is-error" role="alert">No active backend application policy is available for this route.</p>;
  }

  if (props.application && !editableStatuses.has(applicationStatus)) {
    return (
      <section className="application-status-panel">
        <CheckCircle2 aria-hidden="true" />
        <div>
          <StatusChip tone={statusTone(applicationStatus)} label={formatStatus(applicationStatus)} />
          <h2>Application status</h2>
          <p>Your submitted information and documents remain securely attached to this application.</p>
        </div>
      </section>
    );
  }

  return (
    <form className="workflow-form" onSubmit={(event) => void submit(event, mutation.mutate)}>
      {props.children}
      <section className="application-documents">
        <div className="section-heading compact"><div><h2>Required documents</h2><p>Requirements are supplied by the approval service.</p></div></div>
        {requirementsQuery.isLoading || documentsQuery.isLoading ? <p>Loading requirements...</p> : null}
        {requirements.map((requirement, index) => {
          const requirementId = getRecordId(requirement);
          const requirementKey = getFirstRecordString(requirement, ["key"]) ?? "";
          const existing = documents.filter((document) =>
            getFirstRecordString(document, ["requirement_id", "requirementId"]) === requirementId
          );
          const allowedTypes = readStringArray(requirement["allowed_content_types"] ?? requirement["allowedContentTypes"]);
          const maxByteSize = getFirstRecordNumber(requirement, ["max_byte_size", "maxByteSize"]);
          return (
            <label className="document-upload-field" key={recordKey(requirement, `requirement-${index}`)}>
              <span><FileCheck2 aria-hidden="true" /><strong>{getFirstRecordString(requirement, ["display_name", "displayName"]) ?? requirementKey}</strong></span>
              {existing.length > 0
                ? <small>{existing.length} submitted</small>
                : <small>{requirement["is_required"] === true ? "Required" : "Optional"}</small>}
              <span className="file-input-label"><Upload aria-hidden="true" /><input
                type="file"
                accept={allowedTypes.join(",") || undefined}
                onChange={(event) => setFiles((current) => ({ ...current, [requirementKey]: event.currentTarget.files?.[0] ?? null }))}
              /></span>
              {maxByteSize ? <small>Maximum {formatBytes(maxByteSize)}</small> : null}
            </label>
          );
        })}
      </section>
      {mutation.error ? <p className="form-message is-error" role="alert">{mutationErrorMessage(mutation.error)}</p> : null}
      <button type="submit" className="primary-button" disabled={mutation.isPending || requirementsQuery.isLoading || documentsQuery.isLoading}>
        {mutation.isPending ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : null}
        {mutation.isPending ? "Submitting" : props.submitLabel}
      </button>
    </form>
  );
}

function submit(event: FormEvent<HTMLFormElement>, mutate: () => void) {
  event.preventDefault();
  mutate();
}

function validateRequiredDocuments(
  requirements: readonly PlatformRecord[],
  documents: readonly PlatformRecord[],
  files: Readonly<Record<string, File | null>>,
) {
  for (const requirement of requirements) {
    const requirementId = getRecordId(requirement);
    const requirementKey = getFirstRecordString(requirement, ["key"]);
    const minCount = getFirstRecordNumber(requirement, ["min_count", "minCount"]) ?? 0;
    const existingCount = documents.filter((document) =>
      getFirstRecordString(document, ["requirement_id", "requirementId"]) === requirementId
    ).length;
    const file = requirementKey ? files[requirementKey] : null;
    if (requirement["is_required"] === true && existingCount + (file ? 1 : 0) < Math.max(minCount, 1)) {
      throw new Error(`${getFirstRecordString(requirement, ["display_name", "displayName"]) ?? "A required document"} is required.`);
    }
    if (file) validateFile(file, requirement);
  }
}

function validateFile(file: File, requirement: PlatformRecord) {
  const allowedTypes = readStringArray(requirement["allowed_content_types"] ?? requirement["allowedContentTypes"]);
  const maxByteSize = getFirstRecordNumber(requirement, ["max_byte_size", "maxByteSize"]);
  if (allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
    throw new Error(`${file.name} is not an allowed file type.`);
  }
  if (maxByteSize !== null && file.size > maxByteSize) {
    throw new Error(`${file.name} is larger than the configured upload limit.`);
  }
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formatBytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes >= 1 ? megabytes.toFixed(megabytes >= 10 ? 0 : 1) : "<1"} MB`;
}
