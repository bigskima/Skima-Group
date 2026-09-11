import {
  CheckCircle2,
  ClipboardList,
  Eye,
  FileCheck2,
  FileText,
  Image,
  type LucideIcon,
  MessageSquareWarning,
  Play,
  PowerOff,
  RefreshCcw,
  ShieldCheck,
  UserCheck,
  XCircle,
  Zap,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import {
  type ApiGatewayClient,
  createClientIdempotencyKey,
  normalizeStatusLabel,
} from "@skima/frontend-core";
import {
  Button,
  DetailList,
  Dialog,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  StatusBadge,
  TextAreaInput,
  TextInput,
} from "@skima/ui";

import {
  getRecordString,
  type PlatformRecord,
  useGatewayRecords,
} from "./admin-gateway-data";
import { useSessionState } from "./session";

const MutationIdSchema = z.string().uuid();
const MediaReadSessionSchema = z.object({
  assetId: z.string().uuid(),
  contentType: z.string().nullable().optional(),
  expiresInSeconds: z.number().optional(),
  signedUrl: z.string().url(),
});

const APPLICATION_REVIEW_PERMISSION = "platform.applications.review";
const DOCUMENT_REVIEW_PERMISSION = "platform.documents.review";

type ReviewDialogState =
  | { readonly type: "assign"; readonly application: PlatformRecord }
  | { readonly type: "correction"; readonly application: PlatformRecord }
  | { readonly type: "approve"; readonly application: PlatformRecord }
  | { readonly type: "reject"; readonly application: PlatformRecord }
  | { readonly type: "activate-station"; readonly application: PlatformRecord }
  | { readonly type: "activate-driver"; readonly application: PlatformRecord }
  | { readonly type: "deactivate-partner"; readonly application: PlatformRecord }
  | {
    readonly type:
      | "document-approve"
      | "document-correction"
      | "document-reject"
      | "document-replacement"
      | "approve-public-media";
    readonly application: PlatformRecord;
    readonly document: PlatformRecord;
  };

type ReviewCommand =
  | {
    readonly type: "assign";
    readonly applicationId: string;
    readonly reviewerUserId: string;
  }
  | {
    readonly type: "correction";
    readonly applicationId: string;
    readonly applicantMessage: string;
    readonly internalNotes: string | null;
  }
  | {
    readonly type: "decision";
    readonly applicationId: string;
    readonly decision: "approved" | "rejected";
    readonly reason: string;
    readonly reviewerUserId: string | null;
  }
  | {
    readonly type: "activate-station";
    readonly applicationId: string;
    readonly serviceRadiusMeters: number;
  }
  | {
    readonly type: "activate-driver";
    readonly applicationId: string;
  }
  | {
    readonly type: "deactivate-partner";
    readonly applicationId: string;
    readonly reason: string;
  }
  | {
    readonly type: "document-replacement";
    readonly documentSubmissionId: string;
    readonly reason: string;
  }
  | {
    readonly type: "approve-public-media";
    readonly mediaAssetId: string;
    readonly stationBranchId: string;
    readonly isPrimary: boolean;
  }
  | {
    readonly type: "document-review";
    readonly documentSubmissionId: string;
    readonly decision: "approved" | "rejected" | "correction_required";
    readonly applicantMessage: string | null;
    readonly internalNotes: string | null;
  };

export function AdminApplicationsWorkspace() {
  const sessionState = useSessionState();
  const queryClient = useQueryClient();
  const applications = useGatewayRecords("applications", "/runtime/applications");
  const applicationTypes = useGatewayRecords("application-types", "/runtime/application-types");
  const documents = useGatewayRecords("documents", "/runtime/documents");
  const requirements = useGatewayRecords(
    "document-requirements",
    "/runtime/documents/requirements",
  );
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<ReviewDialogState | null>(null);
  const [operationNotice, setOperationNotice] = useState<string | null>(null);

  const applicationRecords = applications.data ?? [];
  const documentRecords = documents.data ?? [];
  const waitingForReview = applicationRecords.filter((record) =>
    ["submitted", "resubmitted", "under_review", "additional_info_required"].includes(
      getRecordString(record, "status") ?? "",
    )
  ).length;
  const selectedApplication = useMemo(
    () =>
      applicationRecords.find((record) =>
        getRecordString(record, "id") === selectedApplicationId
      ) ?? applicationRecords[0] ?? null,
    [applicationRecords, selectedApplicationId],
  );
  const selectedApplicationType = selectedApplication
    ? findRecordById(
      applicationTypes.data ?? [],
      getRecordString(selectedApplication, "application_type_id"),
    )
    : null;
  const selectedDocuments = selectedApplication
    ? documentRecords.filter((record) =>
      getRecordString(record, "application_id") === getRecordString(selectedApplication, "id")
    )
    : [];

  const reviewAction = useMutation({
    mutationFn: (command: ReviewCommand) => executeReviewCommand(sessionState.api, command),
    onSuccess: async (_result, command) => {
      setDialogState(null);
      setOperationNotice(reviewSuccessMessage(command));
      await queryClient.invalidateQueries({ queryKey: ["gateway"] });
    },
  });

  const isLoading = applications.isLoading || applicationTypes.isLoading || documents.isLoading ||
    requirements.isLoading;
  const firstError = applications.error ?? applicationTypes.error ?? documents.error ??
    requirements.error;
  const refreshAll = () => {
    setOperationNotice(null);
    void queryClient.invalidateQueries({ queryKey: ["gateway"] });
  };

  return (
    <>
      <PageHeader
        eyebrow="Partner approvals"
        title="Applications"
        description="Review driver and station applications, check submitted documents, request changes, and make final approval decisions."
        actions={
          <Button icon={RefreshCcw} variant="outline" onClick={refreshAll}>
            Refresh applications
          </Button>
        }
      />
      <section className="skima-grid admin-application-metrics">
        <MetricTile
          label="Waiting for review"
          value={waitingForReview}
          icon={ClipboardList}
          tone={waitingForReview ? "warning" : "success"}
        />
        <MetricTile
          label="Documents submitted"
          value={documents.data?.length ?? 0}
          icon={FileText}
          tone="info"
        />
        <MetricTile
          label="Required checks"
          value={requirements.data?.length ?? 0}
          icon={ShieldCheck}
        />
      </section>
      {operationNotice
        ? <StatusBadge tone="success" className="skima-status-note">{operationNotice}</StatusBadge>
        : null}
      {isLoading ? <LoadingState label="Loading applications" /> : null}
      {firstError
        ? (
          <ErrorState
            title="Applications unavailable"
            message={readErrorMessage(firstError)}
            onRetry={refreshAll}
          />
        )
        : null}
      {!isLoading && !firstError
        ? (
          <section className="skima-review-layout">
            <ApplicationReviewQueue
              applications={applicationRecords}
              applicationTypes={applicationTypes.data ?? []}
              selectedApplicationId={getRecordString(selectedApplication, "id")}
              onSelect={setSelectedApplicationId}
            />
            <ApplicationReviewPanel
              application={selectedApplication}
              applicationType={selectedApplicationType}
              documents={selectedDocuments}
              requirements={requirements.data ?? []}
              currentUserId={sessionState.context?.user.id ?? null}
              isSubmitting={reviewAction.isPending}
              onOpenAction={(nextDialogState) => {
                reviewAction.reset();
                setOperationNotice(null);
                setDialogState(nextDialogState);
              }}
            />
          </section>
        )
        : null}
      <ReviewActionDialog
        state={dialogState}
        error={reviewAction.error}
        isSubmitting={reviewAction.isPending}
        currentUserId={sessionState.context?.user.id ?? null}
        onClose={() => {
          if (!reviewAction.isPending) {
            setDialogState(null);
            reviewAction.reset();
          }
        }}
        onSubmit={(command) => reviewAction.mutate(command)}
      />
    </>
  );
}

function ApplicationReviewQueue(props: {
  readonly applications: readonly PlatformRecord[];
  readonly applicationTypes: readonly PlatformRecord[];
  readonly selectedApplicationId: string | null;
  readonly onSelect: (applicationId: string) => void;
}) {
  if (props.applications.length === 0) {
    return (
      <section className="sk-panel">
        <div className="sk-panel__header">
          <h2>Application list</h2>
        </div>
        <p className="skima-muted">No applications have been submitted yet.</p>
      </section>
    );
  }

  const orderedApplications = [...props.applications].sort(compareApplicationsForReview);

  return (
    <section className="sk-panel">
      <div className="sk-panel__header">
        <div>
          <h2>Application list</h2>
          <p className="skima-muted">Select an application to review its details.</p>
        </div>
        <StatusBadge>{String(props.applications.length)}</StatusBadge>
      </div>
      <div className="skima-review-queue">
        {orderedApplications.map((application) => {
          const applicationId = requireRecordString(application, "id");
          const applicationType = findRecordById(
            props.applicationTypes,
            getRecordString(application, "application_type_id"),
          );
          const title = getRecordString(applicationType, "display_name") ??
            normalizeStatusLabel(getRecordString(applicationType, "key") ?? "Application");
          const status = getRecordString(application, "status") ?? "unknown";
          const applicantName = applicantDisplayName(application);
          const applicantEmail = getRecordString(application, "applicant_email");
          const subjectName = getRecordString(application, "application_subject_name");

          return (
            <button
              key={applicationId}
              type="button"
              className={`skima-review-item ${
                applicationId === props.selectedApplicationId ? "is-active" : ""
              }`}
              onClick={() => props.onSelect(applicationId)}
            >
              <span className="skima-review-item__header">
                <span>
                  <ApplicationTypeTag applicationType={applicationType} />
                  <strong>{title}</strong>
                </span>
                <StatusBadge tone={statusTone(status)}>{normalizeStatusLabel(status)}</StatusBadge>
              </span>
              <span className="skima-review-item__person">
                <ApplicantAvatar application={application} />
                <span>
                  <strong>{applicantName}</strong>
                  <small>{subjectName ?? applicantEmail ?? "Applicant details pending"}</small>
                </span>
              </span>
              <p>
                {formatShortId(applicationId)} ·{" "}
                {formatDate(getRecordString(application, "created_at"))}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ApplicationReviewPanel(props: {
  readonly application: PlatformRecord | null;
  readonly applicationType: PlatformRecord | null;
  readonly documents: readonly PlatformRecord[];
  readonly requirements: readonly PlatformRecord[];
  readonly currentUserId: string | null;
  readonly isSubmitting: boolean;
  readonly onOpenAction: (state: ReviewDialogState) => void;
}) {
  if (!props.application) {
    return (
      <section className="sk-panel">
        <div className="sk-panel__header">
          <h2>Application details</h2>
        </div>
        <p className="skima-muted">Choose an application to review.</p>
      </section>
    );
  }

  const application = props.application;
  const status = getRecordString(application, "status") ?? "unknown";
  const applicationId = requireRecordString(application, "id");
  const applicationName = getRecordString(props.applicationType, "display_name") ??
    normalizeStatusLabel(getRecordString(props.applicationType, "key") ?? "Application");
  const applicantName = applicantDisplayName(application);
  const applicantEmail = getRecordString(application, "applicant_email");
  const applicantPhone = getRecordString(application, "applicant_phone");
  const subjectName = getRecordString(application, "application_subject_name");
  const applicationNoun = applicationActionNoun(props.applicationType);
  const approvedDocuments = props.documents.filter((document) =>
    getRecordString(document, "status") === "approved"
  ).length;
  const pendingDocuments = props.documents.filter((document) =>
    !["approved", "rejected", "expired"].includes(getRecordString(document, "status") ?? "")
  ).length;
  const canAssign = Boolean(props.currentUserId) &&
    ["submitted", "resubmitted", "under_review"].includes(status);
  const canRequestCorrection = status === "under_review";
  const canDecide = Boolean(props.currentUserId) &&
    ["submitted", "resubmitted", "under_review"].includes(status);

  const isApproved = status === "approved";
  const operationalStatus = getRecordString(application, "operational_status");
  const isOperationalActive = operationalStatus === "active";
  const isBusinessCategory = getRecordString(props.applicationType, "application_category") === "business";
  const isDriverCategory = getRecordString(props.applicationType, "application_category") === "driver";

  return (
    <section className="sk-panel">
      <div className="sk-panel__header">
        <div>
          <ApplicationTypeTag applicationType={props.applicationType} />
          <h2>{applicationName}</h2>
          <p className="skima-muted">Reference {formatShortId(applicationId)}</p>
        </div>
        <StatusBadge tone={statusTone(status)}>{normalizeStatusLabel(status)}</StatusBadge>
      </div>
      <div className="skima-review-status-split">
        <div>
          <span>Application</span>
          <strong>{normalizeStatusLabel(status)}</strong>
          <small>Final {applicationNoun.toLowerCase()} approval is made separately from document checks.</small>
        </div>
        <div>
          <span>Documents</span>
          <strong>{approvedDocuments} of {props.documents.length} approved</strong>
          <small>{pendingDocuments} document{pendingDocuments === 1 ? "" : "s"} still need attention.</small>
        </div>
      </div>
      <div className="skima-applicant-card">
        <ApplicantAvatar application={application} size="lg" />
        <div>
          <p>Applicant</p>
          <h3>{applicantName}</h3>
          <small>
            {[applicantEmail, applicantPhone, subjectName].filter(Boolean).join(" • ") ||
              "No contact details submitted yet"}
          </small>
        </div>
      </div>
      <DetailList
        items={[
          { label: "Applicant", value: applicantName },
          {
            label: "Contact",
            value: [applicantEmail, applicantPhone].filter(Boolean).join(" • ") || "Not provided",
          },
          { label: "Station / profile", value: subjectName ?? "Not provided" },
          {
            label: "Reviewer",
            value: getRecordString(application, "reviewer_display_name") ?? "Not assigned",
          },
          { label: "Submitted", value: formatDate(getRecordString(application, "submitted_at")) },
          {
            label: "Live status",
            value: isOperationalActive
              ? "Active"
              : isApproved
              ? "Approved — awaiting activation"
              : "Not active",
          },
          {
            label: "Application type",
            value: normalizeStatusLabel(
              getRecordString(props.applicationType, "application_category") ?? "Application",
            ),
          },
        ]}
      />
      <div className="skima-action-row">
        <Button
          icon={UserCheck}
          variant="outline"
          requiredPermission={APPLICATION_REVIEW_PERMISSION}
          disabled={!canAssign || props.isSubmitting}
          onClick={() => props.onOpenAction({ type: "assign", application })}
        >
          Start review
        </Button>
        <Button
          icon={MessageSquareWarning}
          variant="outline"
          requiredPermission={APPLICATION_REVIEW_PERMISSION}
          disabled={!canRequestCorrection || props.isSubmitting}
          onClick={() => props.onOpenAction({ type: "correction", application })}
        >
          Ask applicant to update
        </Button>
        <Button
          icon={CheckCircle2}
          requiredPermission={APPLICATION_REVIEW_PERMISSION}
          disabled={!canDecide || props.isSubmitting}
          onClick={() => props.onOpenAction({ type: "approve", application })}
        >
          Approve {applicationNoun}
        </Button>
        <Button
          icon={XCircle}
          variant="destructive"
          requiredPermission={APPLICATION_REVIEW_PERMISSION}
          disabled={!canDecide || props.isSubmitting}
          onClick={() => props.onOpenAction({ type: "reject", application })}
        >
          Reject {applicationNoun}
        </Button>
        {isApproved && !isOperationalActive && isBusinessCategory ? (
          <Button
            icon={Zap}
            requiredPermission={APPLICATION_REVIEW_PERMISSION}
            disabled={props.isSubmitting}
            onClick={() => props.onOpenAction({ type: "activate-station", application })}
          >
            Activate station
          </Button>
        ) : null}
        {isApproved && !isOperationalActive && isDriverCategory ? (
          <Button
            icon={Play}
            requiredPermission={APPLICATION_REVIEW_PERMISSION}
            disabled={props.isSubmitting}
            onClick={() => props.onOpenAction({ type: "activate-driver", application })}
          >
            Activate driver
          </Button>
        ) : null}
        {isOperationalActive ? (
          <Button
            icon={PowerOff}
            variant="destructive"
            requiredPermission={APPLICATION_REVIEW_PERMISSION}
            disabled={props.isSubmitting}
            onClick={() => props.onOpenAction({ type: "deactivate-partner", application })}
          >
            Suspend partner
          </Button>
        ) : null}
      </div>
      <DocumentReviewList
        application={application}
        documents={props.documents}
        requirements={props.requirements}
        isSubmitting={props.isSubmitting}
        onOpenAction={props.onOpenAction}
      />
    </section>
  );
}

function DocumentReviewList(props: {
  readonly application: PlatformRecord;
  readonly documents: readonly PlatformRecord[];
  readonly requirements: readonly PlatformRecord[];
  readonly isSubmitting: boolean;
  readonly onOpenAction: (state: ReviewDialogState) => void;
}) {
  const applicationStatus = getRecordString(props.application, "status") ?? "unknown";
  const canReviewDocuments = applicationStatus === "under_review";

  return (
    <section className="sk-panel">
      <div className="sk-panel__header">
        <div>
          <h2>Submitted documents</h2>
          <p className="skima-muted">Review each document before making the final application decision.</p>
        </div>
        <StatusBadge>{String(props.documents.length)}</StatusBadge>
      </div>
      {!canReviewDocuments && props.documents.length > 0 ? (
        <p className="admin-dialog-guidance">
          Start the application review before approving, rejecting, or asking for a new document.
        </p>
      ) : null}
      {props.documents.length === 0
        ? <p className="skima-muted">No documents have been submitted for this application.</p>
        : (
          <div className="skima-document-list">
            {props.documents.map((document) => {
              const documentId = requireRecordString(document, "id");
              const status = getRecordString(document, "status") ?? "unknown";
              const requirement = findRecordById(
                props.requirements,
                getRecordString(document, "requirement_id"),
              );
              const title = getRecordString(requirement, "display_name") ?? "Document";
              const reqKey = getRecordString(requirement, "key") ?? "";
              const fileName = getNestedRecordString(document, ["metadata", "originalFileName"]) ??
                getNestedRecordString(document, ["media_assets", "metadata", "originalFileName"]) ??
                getRecordString(document, "storage_path")?.split("/").at(-1) ??
                "Uploaded file";

              return (
                <article className="skima-document-row" key={documentId}>
                  <div className="skima-document-row__header">
                    <strong>{title}</strong>
                    <StatusBadge tone={statusTone(status)}>
                      {normalizeStatusLabel(status)}
                    </StatusBadge>
                  </div>
                  <DetailList
                    items={[
                      {
                        label: "File type",
                        value: getRecordString(document, "content_type") ?? "Not provided",
                      },
                      { label: "File", value: fileName },
                      { label: "Submitted", value: formatDate(getRecordString(document, "submitted_at")) },
                      {
                        label: "Review note",
                        value: getRecordString(document, "decision_reason") ?? "No review note yet",
                      },
                      { label: "Reference", value: formatShortId(documentId) },
                    ]}
                  />
                  <div className="skima-action-row">
                    <DocumentViewButton document={document} />
                    <Button
                      icon={FileCheck2}
                      variant="outline"
                      size="sm"
                      requiredPermission={DOCUMENT_REVIEW_PERMISSION}
                      disabled={!canReviewDocuments || props.isSubmitting}
                      onClick={() =>
                        props.onOpenAction({
                          type: "document-approve",
                          application: props.application,
                          document,
                        })}
                    >
                      Approve
                    </Button>
                    <Button
                      icon={MessageSquareWarning}
                      variant="outline"
                      size="sm"
                      requiredPermission={DOCUMENT_REVIEW_PERMISSION}
                      disabled={!canReviewDocuments || props.isSubmitting}
                      onClick={() =>
                        props.onOpenAction({
                          type: "document-replacement",
                          application: props.application,
                          document,
                        })}
                    >
                      Ask for new document
                    </Button>
                    {status === "approved" && reqKey.startsWith("station.photo.") ? (
                      <Button
                        icon={Image}
                        variant="outline"
                        size="sm"
                        requiredPermission={APPLICATION_REVIEW_PERMISSION}
                        disabled={props.isSubmitting}
                        onClick={() =>
                          props.onOpenAction({
                            type: "approve-public-media",
                            application: props.application,
                            document,
                          })}
                      >
                        Publish photo
                      </Button>
                    ) : null}
                    <Button
                      icon={XCircle}
                      variant="destructive"
                      size="sm"
                      requiredPermission={DOCUMENT_REVIEW_PERMISSION}
                      disabled={!canReviewDocuments || props.isSubmitting}
                      onClick={() =>
                        props.onOpenAction({
                          type: "document-reject",
                          application: props.application,
                          document,
                        })}
                    >
                      Reject
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
    </section>
  );
}

function DocumentViewButton(props: { readonly document: PlatformRecord }) {
  const { api } = useSessionState();
  const mediaAssetId = getRecordString(props.document, "media_asset_id") ??
    getNestedRecordString(props.document, ["media_assets", "id"]);
  const [error, setError] = useState<string | null>(null);
  const readSession = useMutation({
    mutationFn: () =>
      api.post(
        "/runtime/media/read-sessions",
        {
          assetId: mediaAssetId,
          idempotencyKey: createClientIdempotencyKey(
            "admin.application-document.view",
            mediaAssetId ?? undefined,
          ),
        },
        MediaReadSessionSchema,
      ),
    onSuccess: (session) => {
      setError(null);
      window.open(session.signedUrl, "_blank", "noopener,noreferrer");
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : "The document file could not be opened.");
    },
  });

  return (
    <span className="skima-document-view">
      <Button
        icon={Eye}
        variant="outline"
        size="sm"
        requiredPermission={DOCUMENT_REVIEW_PERMISSION}
        disabled={!mediaAssetId || readSession.isPending}
        onClick={() => readSession.mutate()}
      >
        {readSession.isPending ? "Opening" : "Open document"}
      </Button>
      {error ? <small role="alert">{error}</small> : null}
    </span>
  );
}

function ReviewActionDialog(props: {
  readonly state: ReviewDialogState | null;
  readonly currentUserId: string | null;
  readonly error: unknown;
  readonly isSubmitting: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (command: ReviewCommand) => void;
}) {
  const [reason, setReason] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setReason(props.state?.type === "activate-station" ? "8000" : "");
    setInternalNotes("");
    setSubmitError(null);
  }, [props.state]);

  const state = props.state;

  if (!state) {
    return null;
  }

  const title = reviewDialogTitle(state);
  const reasonRequired = !["assign", "activate-driver", "approve-public-media"].includes(state.type);
  const reasonLabel = reviewReasonLabel(state);
  const applicationStatus = getRecordString(state.application, "status") ?? "unknown";
  const reviewActionAllowedStatuses = ["submitted", "resubmitted", "under_review"];
  const actionAllowed = (state.type === "assign" || state.type === "approve" || state.type === "reject")
    ? reviewActionAllowedStatuses.includes(applicationStatus)
    : true;
  const canSubmit = actionAllowed && (state.type === "assign"
    ? Boolean(props.currentUserId)
    : reasonRequired
    ? reason.trim().length > 0
    : true);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canSubmit) {
      if (!actionAllowed) {
        setSubmitError(
          `This action is not available while the application is ${normalizeStatusLabel(applicationStatus).toLowerCase()}.`,
        );
      }
      return;
    }

    setSubmitError(null);
    const applicationId = requireRecordString(state.application, "id");

    if (state.type === "assign") {
      props.onSubmit({
        type: "assign",
        applicationId,
        reviewerUserId: props.currentUserId ?? "",
      });
      return;
    }

    if (state.type === "correction") {
      props.onSubmit({
        type: "correction",
        applicationId,
        applicantMessage: reason.trim(),
        internalNotes: optionalTrimmedValue(internalNotes),
      });
      return;
    }

    if (state.type === "approve" || state.type === "reject") {
      props.onSubmit({
        type: "decision",
        applicationId,
        decision: state.type === "approve" ? "approved" : "rejected",
        reason: reason.trim(),
        reviewerUserId: props.currentUserId,
      });
      return;
    }

    if (state.type === "activate-station") {
      props.onSubmit({
        type: "activate-station",
        applicationId,
        serviceRadiusMeters: Number(reason.trim()) || 8000,
      });
      return;
    }

    if (state.type === "activate-driver") {
      props.onSubmit({ type: "activate-driver", applicationId });
      return;
    }

    if (state.type === "deactivate-partner") {
      props.onSubmit({
        type: "deactivate-partner",
        applicationId,
        reason: reason.trim() || "Administrative suspension",
      });
      return;
    }

    if (state.type === "document-replacement") {
      const documentSubmissionId = requireRecordString(state.document, "id");
      props.onSubmit({
        type: "document-replacement",
        documentSubmissionId,
        reason: reason.trim(),
      });
      return;
    }

    if (state.type === "approve-public-media") {
      const mediaAssetId = requireRecordString(state.document, "media_asset_id");
      const stationBranchId = getRecordString(state.application, "branch_id") ??
        requireRecordString(state.application, "id");
      props.onSubmit({
        type: "approve-public-media",
        mediaAssetId,
        stationBranchId,
        isPrimary: false,
      });
      return;
    }

    const documentSubmissionId = requireRecordString(state.document, "id");
    const decision = state.type === "document-approve"
      ? "approved"
      : state.type === "document-reject"
      ? "rejected"
      : "correction_required";

    props.onSubmit({
      type: "document-review",
      documentSubmissionId,
      decision,
      applicantMessage: state.type === "document-correction" ? reason.trim() : null,
      internalNotes: state.type === "document-correction"
        ? optionalTrimmedValue(internalNotes)
        : reason.trim(),
    });
  };

  return (
    <Dialog
      title={title}
      isOpen={Boolean(props.state)}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose} disabled={props.isSubmitting}>
            Cancel
          </Button>
          <Button
            icon={reviewDialogIcon(state)}
            type="submit"
            form="review-action-form"
            isLoading={props.isSubmitting}
            disabled={!canSubmit}
            variant={reviewDialogVariant(state)}
          >
            {reviewDialogSubmitLabel(state)}
          </Button>
        </>
      }
    >
      <form id="review-action-form" className="skima-form-grid" onSubmit={submit}>
        <ReviewDialogGuidance state={state} />
        {state.type === "activate-station" ? (
          <TextInput
            id="service-radius"
            label="Service radius (metres)"
            helperText="This is the maximum service radius for this station when it first becomes active. You can change it later."
            type="number"
            inputMode="numeric"
            min={500}
            max={100000}
            step={100}
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
            required
          />
        ) : reasonRequired ? (
          <TextAreaInput
            id="review-reason"
            label={reasonLabel}
            helperText={reviewReasonHelper(state)}
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
            required
          />
        ) : null}
        {state.type === "correction" || state.type === "document-correction"
          ? (
            <TextAreaInput
              id="review-internal-notes"
              label="Internal note (optional)"
              helperText="Only SKIMA administrators can see this note."
              value={internalNotes}
              onChange={(event) => setInternalNotes(event.currentTarget.value)}
            />
          )
          : null}
        {props.error
          ? <StatusBadge tone="danger">{readErrorMessage(props.error)}</StatusBadge>
          : null}
        {submitError
          ? <StatusBadge tone="danger">{submitError}</StatusBadge>
          : null}
      </form>
    </Dialog>
  );
}

function ReviewDialogGuidance(props: { readonly state: ReviewDialogState }) {
  const state = props.state;
  let message: string | null = null;

  if (state.type === "assign") {
    message = "This starts the review and assigns it to your administrator account.";
  } else if (state.type === "document-replacement") {
    message = "The applicant will be asked to upload a new copy of this document. Explain clearly what is wrong so they know exactly what to replace.";
  } else if (state.type === "activate-station") {
    message = "Activation makes this approved station available for live SKIMA operations, subject to its service-area and availability settings.";
  } else if (state.type === "activate-driver") {
    message = "Activation enables the approved driver profile and SKIMA Driver Pass for live dispatch eligibility.";
  } else if (state.type === "deactivate-partner") {
    message = "Suspending a live partner stops operational access until SKIMA activates the partner again.";
  } else if (state.type === "approve-public-media") {
    message = "This photo will become eligible to appear on the station's public customer-facing profile.";
  }

  return message ? <p className="admin-dialog-guidance">{message}</p> : null;
}

async function executeReviewCommand(
  api: ApiGatewayClient,
  command: ReviewCommand,
): Promise<string> {
  if (command.type === "assign") {
    return api.post(
      "/runtime/applications/reviewer",
      {
        applicationId: command.applicationId,
        reviewerUserId: command.reviewerUserId,
        idempotencyKey: createClientIdempotencyKey(
          "application-review.assign",
          command.applicationId,
        ),
        metadata: { source: "admin_review_console" },
      },
      MutationIdSchema,
    );
  }

  if (command.type === "correction") {
    return api.post(
      "/runtime/applications/corrections",
      {
        applicationId: command.applicationId,
        applicantMessage: command.applicantMessage,
        internalNotes: command.internalNotes,
        idempotencyKey: createClientIdempotencyKey(
          "application-review.correction",
          command.applicationId,
        ),
        metadata: { source: "admin_review_console" },
      },
      MutationIdSchema,
    );
  }

  if (command.type === "activate-station") {
    return api.post(
      "/runtime/applications/activate-station",
      {
        applicationId: command.applicationId,
        serviceRadiusMeters: command.serviceRadiusMeters,
        idempotencyKey: createClientIdempotencyKey(
          "application-review.activate-station",
          command.applicationId,
        ),
        metadata: { source: "admin_review_console" },
      },
      MutationIdSchema,
    );
  }

  if (command.type === "activate-driver") {
    return api.post(
      "/runtime/applications/activate-driver",
      {
        applicationId: command.applicationId,
        idempotencyKey: createClientIdempotencyKey(
          "application-review.activate-driver",
          command.applicationId,
        ),
        metadata: { source: "admin_review_console" },
      },
      MutationIdSchema,
    );
  }

  if (command.type === "deactivate-partner") {
    return api.post(
      "/runtime/applications/deactivate",
      {
        applicationId: command.applicationId,
        reason: command.reason,
        idempotencyKey: createClientIdempotencyKey(
          "application-review.deactivate",
          command.applicationId,
        ),
        metadata: { source: "admin_review_console" },
      },
      MutationIdSchema,
    );
  }

  if (command.type === "document-replacement") {
    return api.post(
      "/runtime/documents/review",
      {
        documentSubmissionId: command.documentSubmissionId,
        decision: "correction_required",
        applicantMessage: command.reason,
        internalNotes: null,
        idempotencyKey: createClientIdempotencyKey(
          "document-review.replacement",
          command.documentSubmissionId,
        ),
        metadata: {
          source: "admin_review_console",
          replacementRequested: true,
        },
      },
      MutationIdSchema,
    );
  }

  if (command.type === "approve-public-media") {
    return api.post(
      "/runtime/media/approve-public",
      {
        mediaAssetId: command.mediaAssetId,
        stationBranchId: command.stationBranchId,
        isPrimary: command.isPrimary,
        displayOrder: 0,
        idempotencyKey: createClientIdempotencyKey(
          "media.approve-public",
          `${command.stationBranchId}:${command.mediaAssetId}`,
        ),
      },
      MutationIdSchema,
    );
  }

  if (command.type === "decision") {
    if (command.reviewerUserId) {
      await api.post(
        "/runtime/applications/reviewer",
        {
          applicationId: command.applicationId,
          reviewerUserId: command.reviewerUserId,
          idempotencyKey: createClientIdempotencyKey(
            "application-review.auto-assign",
            command.applicationId,
          ),
          metadata: { source: "admin_review_console", reason: "auto_start_before_decision" },
        },
        MutationIdSchema,
      );
    }

    return api.post(
      "/runtime/applications/decisions",
      {
        applicationId: command.applicationId,
        decision: command.decision,
        reason: command.reason,
        idempotencyKey: createClientIdempotencyKey(
          `application-review.${command.decision}`,
          command.applicationId,
        ),
        metadata: { source: "admin_review_console" },
      },
      MutationIdSchema,
    );
  }

  return api.post(
    "/runtime/documents/review",
    {
      documentSubmissionId: command.documentSubmissionId,
      decision: command.decision,
      applicantMessage: command.applicantMessage,
      internalNotes: command.internalNotes,
      idempotencyKey: createClientIdempotencyKey(
        `document-review.${command.decision}`,
        command.documentSubmissionId,
      ),
      metadata: { source: "admin_review_console" },
    },
    MutationIdSchema,
  );
}

function getNestedRecordString(
  record: PlatformRecord | null | undefined,
  path: readonly string[],
): string | null {
  let value: unknown = record;

  for (const key of path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    value = (value as PlatformRecord)[key];
  }

  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function ApplicationTypeTag(props: { readonly applicationType: PlatformRecord | null }) {
  return <span className="skima-application-type-tag">{applicationKindLabel(props.applicationType)}</span>;
}

function applicationActionNoun(applicationType: PlatformRecord | null): string {
  const kind = applicationKindLabel(applicationType).replace(/\s+APPLICATION$/i, "");
  return kind.charAt(0) + kind.slice(1).toLowerCase();
}

function applicationKindLabel(applicationType: PlatformRecord | null): string {
  const category = getRecordString(applicationType, "application_category");
  const key = getRecordString(applicationType, "key") ?? "";
  const workspace = getNestedRecordString(applicationType, ["metadata", "workspace"]);

  if (category === "driver" || workspace === "driver" || key.includes(".driver.")) {
    return "DRIVER APPLICATION";
  }

  if (workspace === "station" || key.includes(".station.")) {
    return "STATION APPLICATION";
  }

  if (category === "vehicle" || key.includes(".vehicle.")) {
    return "VEHICLE APPLICATION";
  }

  if (category) {
    return `${normalizeStatusLabel(category).toUpperCase()} APPLICATION`;
  }

  return "APPLICATION";
}

function ApplicantAvatar(props: {
  readonly application: PlatformRecord;
  readonly size?: "sm" | "lg";
}) {
  const avatarUrl = getNestedRecordString(props.application, ["applicant_profile", "avatarUrl"]);
  const displayName = applicantDisplayName(props.application);
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "A";
  const className = `skima-applicant-avatar ${props.size === "lg" ? "is-large" : ""}`;

  if (avatarUrl && /^https?:\/\//i.test(avatarUrl)) {
    return <img className={className} src={avatarUrl} alt="" />;
  }

  return <span className={className}>{initials}</span>;
}

function applicantDisplayName(application: PlatformRecord): string {
  return getRecordString(application, "applicant_display_name") ??
    getNestedRecordString(application, ["applicant_profile", "displayName"]) ??
    getRecordString(application, "applicant_email") ??
    formatShortId(getRecordString(application, "applicant_user_id"));
}

function requireRecordString(record: PlatformRecord, key: string): string {
  const value = getRecordString(record, key);

  if (!value) {
    throw new Error(`${key} is required for this action.`);
  }

  return value;
}

function findRecordById(
  records: readonly PlatformRecord[],
  id: string | null,
): PlatformRecord | null {
  if (!id) {
    return null;
  }

  return records.find((record) => getRecordString(record, "id") === id) ?? null;
}

function compareApplicationsForReview(left: PlatformRecord, right: PlatformRecord): number {
  const leftStatus = getRecordString(left, "status") ?? "";
  const rightStatus = getRecordString(right, "status") ?? "";
  const statusDifference = reviewStatusWeight(leftStatus) - reviewStatusWeight(rightStatus);

  if (statusDifference !== 0) {
    return statusDifference;
  }

  return dateSortValue(getRecordString(right, "created_at")) -
    dateSortValue(getRecordString(left, "created_at"));
}

function reviewStatusWeight(status: string): number {
  const weights: Readonly<Record<string, number>> = {
    submitted: 0,
    resubmitted: 1,
    under_review: 2,
    additional_info_required: 3,
    draft: 4,
    incomplete: 5,
    approved: 6,
    rejected: 7,
    suspended: 8,
    withdrawn: 9,
    expired: 10,
  };

  return weights[status] ?? 11;
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (["approved", "active", "completed"].includes(status)) {
    return "success";
  }

  if (["rejected", "failed", "suspended", "quarantined"].includes(status)) {
    return "danger";
  }

  if (
    ["submitted", "resubmitted", "under_review", "correction_required", "additional_info_required"]
      .includes(status)
  ) {
    return "warning";
  }

  if (["draft", "incomplete", "uploaded"].includes(status)) {
    return "info";
  }

  return "neutral";
}

function formatShortId(value: string | null): string {
  if (!value) {
    return "None";
  }

  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function dateSortValue(value: string | null): number {
  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function optionalTrimmedValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function reviewDialogTitle(state: ReviewDialogState): string {
  if (state.type === "assign") return "Start application review";
  if (state.type === "correction") return "Ask applicant to update application";
  if (state.type === "approve") return "Approve application";
  if (state.type === "reject") return "Reject application";
  if (state.type === "activate-station") return "Activate station";
  if (state.type === "activate-driver") return "Activate driver";
  if (state.type === "deactivate-partner") return "Suspend partner";
  if (state.type === "document-approve") return "Approve document";
  if (state.type === "document-reject") return "Reject document";
  if (state.type === "document-replacement") return "Ask for a new document";
  if (state.type === "approve-public-media") return "Publish station photo";
  return "Ask for a document update";
}

function reviewReasonLabel(state: ReviewDialogState): string {
  if (["correction", "document-correction", "document-replacement"].includes(state.type)) {
    return "Message to applicant";
  }
  if (state.type === "deactivate-partner") return "Reason for suspension";
  if (state.type === "approve" || state.type === "reject") return "Reason for decision";
  if (state.type === "document-approve" || state.type === "document-reject") return "Review note";
  return "Reason";
}

function reviewReasonHelper(state: ReviewDialogState): string | undefined {
  if (state.type === "document-replacement") {
    return "Explain what is wrong with the current document and what the applicant needs to upload instead.";
  }
  if (state.type === "correction" || state.type === "document-correction") {
    return "Write a clear instruction the applicant can act on. This message will be visible to them.";
  }
  if (state.type === "approve" || state.type === "reject") {
    return "Record a concise reason for the final application decision.";
  }
  if (state.type === "deactivate-partner") {
    return "Explain why live access is being suspended. This becomes part of the administrative record.";
  }
  return undefined;
}

function reviewDialogSubmitLabel(state: ReviewDialogState): string {
  if (state.type === "assign") return "Start review";
  if (state.type === "correction") return "Send update request";
  if (state.type === "approve") return "Approve application";
  if (state.type === "reject") return "Reject application";
  if (state.type === "activate-station") return "Activate station";
  if (state.type === "activate-driver") return "Activate driver";
  if (state.type === "deactivate-partner") return "Suspend partner";
  if (state.type === "document-approve") return "Approve document";
  if (state.type === "document-reject") return "Reject document";
  if (state.type === "document-replacement") return "Send request";
  if (state.type === "approve-public-media") return "Publish photo";
  return "Send request";
}

function reviewSuccessMessage(command: ReviewCommand): string {
  if (command.type === "assign") return "Review started and assigned to you.";
  if (command.type === "correction") return "Update request sent to the applicant.";
  if (command.type === "decision") {
    return command.decision === "approved" ? "Application approved." : "Application rejected.";
  }
  if (command.type === "activate-station") return "Station activated for live operations.";
  if (command.type === "activate-driver") return "Driver activated for live dispatch.";
  if (command.type === "deactivate-partner") return "Partner access suspended.";
  if (command.type === "document-replacement") {
    return "Request for a new document sent to the applicant.";
  }
  if (command.type === "approve-public-media") {
    return "Station photo approved for public display.";
  }
  if (command.type === "document-review") {
    if (command.decision === "approved") return "Document approved.";
    if (command.decision === "rejected") return "Document rejected.";
    return "Document update requested.";
  }
  return "Changes saved.";
}

function reviewDialogIcon(state: ReviewDialogState): LucideIcon {
  if (state.type === "assign") return UserCheck;
  if (state.type === "activate-station") return Zap;
  if (state.type === "activate-driver") return Play;
  if (state.type === "deactivate-partner") return PowerOff;
  if (state.type === "approve-public-media") return Image;
  if (
    state.type === "correction" ||
    state.type === "document-correction" ||
    state.type === "document-replacement"
  ) {
    return MessageSquareWarning;
  }
  if (state.type === "reject" || state.type === "document-reject") return XCircle;
  return CheckCircle2;
}

function reviewDialogVariant(state: ReviewDialogState): "primary" | "destructive" {
  return state.type === "reject" ||
      state.type === "document-reject" ||
      state.type === "deactivate-partner"
    ? "destructive"
    : "primary";
}

function readErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "The action could not be completed. Please try again.";
  }
  if (/requested resource was not found|route_not_found/i.test(error.message)) {
    return "This action is temporarily unavailable. Refresh the page and try again.";
  }
  return error.message;
}
