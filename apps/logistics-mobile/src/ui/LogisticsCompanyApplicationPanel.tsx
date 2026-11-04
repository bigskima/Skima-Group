import * as DocumentPicker from "expo-document-picker";
import * as Linking from "expo-linking";
import { File, UploadType } from "expo-file-system";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClientIdempotencyKey } from "@skima/frontend-core";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { asString, useLogisticsQuery } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { AppField } from "./AppField";
import { Card } from "./Card";
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "./StatusPill";

type Row = Record<string, unknown>;
type RegistrationStatus = "registered" | "in_progress" | "not_registered";
const IdSchema = z.string().uuid();
const RecordSchema = z.record(z.string(), z.unknown());
const UploadSessionSchema = z.object({
  signedUrl: z.string().url(),
  method: z.literal("PUT"),
  storageBucket: z.string(),
  storagePath: z.string(),
});

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function isTerminal(status: string) {
  return ["approved", "rejected", "suspended", "withdrawn", "expired"].includes(status);
}

function isValidNin(value: string) {
  return /^[0-9]{11}$/.test(value.trim());
}

export function LogisticsCompanyApplicationPanel({
  organizationId,
  displayName,
  legalName,
  registrationStatus: initialRegistrationStatus,
}: {
  organizationId: string;
  displayName: string;
  legalName: string | null;
  registrationStatus: RegistrationStatus;
}) {
  const { palette } = useAppTheme();
  const { api, session } = useSession();
  const client = useQueryClient();
  const types = useLogisticsQuery(["application-types"], "/runtime/application-types", true, 120_000);
  const applications = useLogisticsQuery(["applications"], "/runtime/applications", true, 30_000);
  const requirements = useLogisticsQuery(["document-requirements"], "/runtime/documents/requirements", true, 120_000);
  const documents = useLogisticsQuery(["documents"], "/runtime/documents", true, 20_000);

  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [registrationStatus, setRegistrationStatus] = useState<RegistrationStatus>(initialRegistrationStatus);
  const [applicantName, setApplicantName] = useState("");
  const [nin, setNin] = useState("");
  const [editing, setEditing] = useState(true);
  const [policyConfirmed, setPolicyConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationSessionId, setVerificationSessionId] = useState<string | null>(null);

  const applicationType = types.data?.find((item) => asString(item, "key") === "application.logistics.company") ?? null;
  const applicationTypeId = asString(applicationType, "id");
  const requirementSetId = asString(applicationType, "document_requirement_set_id");
  const application = useMemo(() => (applications.data ?? [])
    .filter((item) => asString(item, "application_type_id") === applicationTypeId &&
      asString(item, "organization_id") === organizationId)
    .sort((left, right) =>
      Date.parse(asString(right, "created_at") ?? "") - Date.parse(asString(left, "created_at") ?? "")
    )[0] ?? null,
  [applications.data, applicationTypeId, organizationId]);
  const applicationId = asString(application, "id");
  const applicationStatus = asString(application, "status") ?? "draft";
  const activeVersion = Number(application?.active_version ?? 1);
  const canEdit = Boolean(applicationId && !isTerminal(applicationStatus));
  const configuredRequirements = useMemo(() => (requirements.data ?? [])
    .filter((item) => asString(item, "requirement_set_id") === requirementSetId &&
      asString(item, "status") === "active")
    .sort((left, right) =>
      (asString(left, "display_name") ?? "").localeCompare(asString(right, "display_name") ?? "")
    ),
  [requirements.data, requirementSetId]);

  const payloadVersions = useLogisticsQuery(
    ["application-payload", applicationId ?? "none"],
    `/runtime/applications/payload?applicationId=${encodeURIComponent(applicationId ?? "")}`,
    Boolean(applicationId),
    30_000,
  );
  const activePayload = useMemo(() => {
    const version = (payloadVersions.data ?? []).find((item) => Number(item.version) === activeVersion) ??
      (payloadVersions.data ?? [])[0];
    return record(version?.payload);
  }, [payloadVersions.data, activeVersion]);
  const applicant = record(activePayload.applicant);
  const activeNin = asString(applicant, "nin") ?? "";
  const activeApplicantName = asString(applicant, "full_name") ?? "";
  const registrationValue = asString(record(activePayload.organization), "registrationStatus");
  const derivedRegistrationStatus: RegistrationStatus =
    registrationValue === "registered" || registrationValue === "in_progress"
      ? registrationValue
      : "not_registered";

  useEffect(() => {
    if (!applicationId || !payloadVersions.data?.length) return;
    setApplicantName(activeApplicantName);
    setNin(activeNin);
    setRegistrationStatus(derivedRegistrationStatus);
    setEditing(!isTerminal(applicationStatus));
  }, [applicationId, activeVersion, payloadVersions.data?.length]);

  const policy = useQuery({
    queryKey: ["logistics-company-policy", applicationId ?? "none"],
    enabled: Boolean(applicationId) && Boolean(session?.user.id),
    queryFn: async () => {
      const { data, error: policyError } = await session!.supabase.rpc("read_current_policy", {
        target_policy_key: "policy.partner.participation",
      });
      if (policyError) throw policyError;
      return RecordSchema.parse(data);
    },
    staleTime: 60_000,
  });
  const acceptedPolicy = useQuery({
    queryKey: ["logistics-company-policy-accepted", applicationId ?? "none"],
    enabled: Boolean(applicationId) && Boolean(session?.user.id),
    queryFn: async () => {
      const { data, error: acceptanceError } = await session!.supabase.rpc("has_accepted_current_policy", {
        target_policy_key: "policy.partner.participation",
        target_application_id: applicationId,
      });
      if (acceptanceError) throw acceptanceError;
      return data === true;
    },
    refetchInterval: 30_000,
  });

  const verification = useLogisticsQuery(
    ["company-applicant-verification", applicationId ?? "none"],
    `/runtime/partner-verification/requirements?applicationId=${encodeURIComponent(applicationId ?? "")}`,
    Boolean(applicationId),
    15_000,
  );
  const identityCheck = (verification.data ?? []).find((item) =>
    asString(item, "verificationKey", "verification_key") === "verification.person.identity"
  ) ?? null;
  const identityStatus = asString(identityCheck, "status") ?? "not_started";
  const identitySessionId = asString(identityCheck, "sessionId", "session_id") ?? verificationSessionId;
  const identityPassed = identityStatus === "passed";
  const identityAvailable = identityCheck?.automaticAvailable !== false;

  const createApplication = useMutation({
    mutationFn: () => {
      const fullName = applicantName.trim();
      const ninValue = nin.trim();
      if (!fullName) throw new Error("Enter the full name of the person registering this company.");
      if (!isValidNin(ninValue)) throw new Error("Enter a valid 11-digit NIN.");
      return api.post("/runtime/applications", {
        applicationTypeKey: "application.logistics.company",
        organizationId,
        idempotencyKey: createClientIdempotencyKey("logistics.company.application", organizationId),
        source: "skima.logistics.company.application",
        payload: {
          organization: {
            organizationId,
            displayName,
            legalName,
            registrationStatus,
            registrationEvidenceOptional: true,
          },
          applicant: {
            full_name: fullName,
            nin: ninValue,
            role: "authorised_representative",
          },
          application: {
            productModule: "logistics_network",
            submittedFrom: "skima-logistics-mobile",
          },
        },
        metadata: {
          productModule: "logistics_network",
          organizationId,
          platformReviewRequired: true,
          registrationStatus,
        },
      }, IdSchema);
    },
    onSuccess: async () => {
      setError(null);
      setMessage("Application started. Add your identity document, complete the secure identity check and review the partner terms before submitting.");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["skima-logistics", "applications"] }),
        client.invalidateQueries({ queryKey: ["skima-logistics", "application-types"] }),
      ]);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "The company application could not be started."),
  });

  const saveApplication = useMutation({
    mutationFn: async () => {
      if (!applicationId || !canEdit) throw new Error("This application can no longer be edited.");
      const fullName = applicantName.trim();
      const ninValue = nin.trim();
      if (!fullName) throw new Error("Enter the full name of the person registering this company.");
      if (!isValidNin(ninValue)) throw new Error("Enter a valid 11-digit NIN.");

      const nextPayload: Row = {
        ...activePayload,
        organization: {
          ...record(activePayload.organization),
          organizationId,
          displayName,
          legalName,
          registrationStatus,
          registrationEvidenceOptional: true,
        },
        applicant: {
          ...applicant,
          full_name: fullName,
          nin: ninValue,
          role: "authorised_representative",
        },
        application: {
          ...record(activePayload.application),
          productModule: "logistics_network",
          submittedFrom: "skima-logistics-mobile",
        },
      };
      return api.post("/runtime/applications/payload", {
        applicationId,
        payload: nextPayload,
        idempotencyKey: createClientIdempotencyKey(
          "logistics.company.application.update",
          `${applicationId}:${activeVersion}:${Date.now()}`,
        ),
        metadata: {
          productModule: "logistics_network",
          sourceSurface: "logistics_company_application",
          revisionOfVersion: activeVersion,
        },
      }, IdSchema);
    },
    onSuccess: async () => {
      setError(null);
      setMessage("Your application changes have been saved. SKIMA's review remains open.");
      setEditing(false);
      await Promise.all([
        payloadVersions.refetch(),
        applications.refetch(),
        client.invalidateQueries({ queryKey: ["skima-logistics", "applications"] }),
      ]);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "The application changes could not be saved."),
  });

  const uploadDocument = useMutation({
    mutationFn: async (requirement: Row) => {
      if (!applicationId || !session?.user.id || !canEdit) {
        throw new Error("You can add documents while this application is awaiting SKIMA's final decision.");
      }
      const requirementKey = asString(requirement, "key");
      if (!requirementKey) throw new Error("This document requirement is missing its key.");
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return null;

      const asset = picked.assets[0];
      if (asset.size && asset.size > 50 * 1024 * 1024) {
        throw new Error("Each company document must be no larger than 50 MB.");
      }
      const contentType = asset.mimeType && (
        asset.mimeType === "application/pdf" || asset.mimeType.startsWith("image/")
      ) ? asset.mimeType : "application/octet-stream";
      const extension = asset.name.includes(".") ? asset.name.split(".").pop()?.toLowerCase() : "bin";
      const uploadKey = createClientIdempotencyKey(
        "logistics.company.document",
        `${applicationId}:${requirementKey}:${asset.name}:${asset.size ?? "unknown"}`,
      );
      const uploadSession = await api.post("/runtime/media/upload-sessions", {
        contentType,
        fileName: asset.name || `${requirementKey}.${extension ?? "bin"}`,
        idempotencyKey: uploadKey,
        storageBucket: "skima-platform-documents",
      }, UploadSessionSchema);
      const file = new File(asset.uri);
      const uploaded = await file.createUploadTask(uploadSession.signedUrl, {
        httpMethod: "PUT",
        uploadType: UploadType.BINARY_CONTENT,
        mimeType: contentType,
        headers: { "content-type": contentType },
        sessionType: "background",
      }).uploadAsync();
      if (uploaded.status < 200 || uploaded.status >= 300) {
        throw new Error(`The document upload was rejected (${uploaded.status}).`);
      }
      return api.post("/runtime/documents", {
        applicationId,
        requirementKey,
        byteSize: asset.size ?? file.size,
        contentType,
        idempotencyKey: `${uploadKey}:submission`,
        metadata: {
          originalFileName: asset.name,
          productModule: "logistics_network",
          organizationId,
        },
        source: "skima.logistics.company.application",
        storageBucket: uploadSession.storageBucket,
        storagePath: uploadSession.storagePath,
      }, IdSchema);
    },
    onSuccess: async () => {
      setError(null);
      setMessage("Document uploaded and linked to your private company application.");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["skima-logistics", "documents"] }),
        documents.refetch(),
      ]);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "The document could not be uploaded."),
  });

  const acceptTerms = useMutation({
    mutationFn: async () => {
      const versionId = asString(policy.data, "versionId");
      const statement = asString(policy.data, "acceptanceStatement");
      if (!applicationId || !versionId || !statement || !policyConfirmed) {
        throw new Error("Open the current partner terms and confirm that you agree before continuing.");
      }
      const { data, error: acceptanceError } = await session!.supabase.rpc("accept_policy", {
        target_policy_key: "policy.partner.participation",
        target_policy_version_id: versionId,
        target_application_id: applicationId,
        target_role_key: "logistics_company",
        target_acceptance_statement: statement,
        target_source: "skima.logistics.mobile",
        target_idempotency_key: createClientIdempotencyKey(
          "logistics.company.partner-policy",
          `${applicationId}:${versionId}`,
        ),
        target_metadata: { surface: "logistics_company_application" },
      });
      if (acceptanceError) throw acceptanceError;
      return data;
    },
    onSuccess: async () => {
      setError(null);
      setPolicyConfirmed(false);
      await acceptedPolicy.refetch();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "The partner terms could not be accepted."),
  });

  const startIdentityVerification = async () => {
    if (!applicationId || !canEdit) return;
    setVerificationBusy(true);
    setVerificationMessage(null);
    try {
      const result = await api.post("/runtime/partner-verification/sessions", {
        applicationId,
        verificationKey: "verification.person.identity",
        idempotencyKey: createClientIdempotencyKey(
          "logistics.company.didit.identity",
          `${applicationId}:${activeVersion}`,
        ),
      }, RecordSchema);
      const sessionId = asString(result, "id");
      const verificationUrl = asString(result, "verificationUrl", "verification_url");
      if (sessionId) setVerificationSessionId(sessionId);
      if (verificationUrl) {
        await Linking.openURL(verificationUrl);
        setVerificationMessage("Complete the secure identity check, return to SKIMA and tap Check result.");
      } else {
        setVerificationMessage("Your secure identity session is ready. Tap Check result after completing the provider flow.");
      }
      await verification.refetch();
    } catch (cause) {
      setVerificationMessage(cause instanceof Error ? cause.message : "The secure identity check could not be started. You can still upload the required identity document for SKIMA review.");
    } finally {
      setVerificationBusy(false);
    }
  };

  const refreshIdentityVerification = async () => {
    if (!applicationId || !identitySessionId) return;
    setVerificationBusy(true);
    setVerificationMessage(null);
    try {
      const result = await api.post("/runtime/partner-verification/sessions/refresh", {
        applicationId,
        sessionId: identitySessionId,
        idempotencyKey: createClientIdempotencyKey(
          "logistics.company.didit.refresh",
          `${applicationId}:${identitySessionId}`,
        ),
      }, RecordSchema);
      const status = asString(result, "status") ?? "pending";
      setVerificationMessage(status === "passed"
        ? "Your identity check has passed."
        : status === "manual_review"
          ? "Your identity check is with the verification provider for review."
          : status === "failed"
            ? "The automatic check did not pass. Upload the required identity evidence or retry."
            : "Your identity check is still processing.");
      await verification.refetch();
    } catch (cause) {
      setVerificationMessage(cause instanceof Error ? cause.message : "The identity result could not be refreshed.");
    } finally {
      setVerificationBusy(false);
    }
  };

  const submitApplication = useMutation({
    mutationFn: () => {
      if (!applicationId) throw new Error("Start and save the company application first.");
      const identityRequirement = configuredRequirements.find((item) =>
        asString(item, "key") === "logistics.company.owner-identity"
      );
      const identityRequirementId = asString(identityRequirement, "id");
      const hasIdentityEvidence = (documents.data ?? []).some((document) =>
        asString(document, "application_id") === applicationId &&
        asString(document, "status") !== "rejected" &&
        (asString(document, "requirement_id") === identityRequirementId ||
          asString(record(document.metadata), "requirement_key") === "logistics.company.owner-identity")
      );
      if (!hasIdentityEvidence) {
        throw new Error("Upload the applicant's NIN/identity document before submitting.");
      }
      if (acceptedPolicy.data !== true) {
        throw new Error("Review and accept the current SKIMA Partner Participation Terms before submitting.");
      }
      if (!identityPassed && !hasIdentityEvidence) {
        throw new Error("Complete identity verification or provide the required identity evidence.");
      }
      return api.post("/runtime/applications/submit", {
        applicationId,
        idempotencyKey: createClientIdempotencyKey(
          "logistics.company.application.submit",
          `${applicationId}:${activeVersion}`,
        ),
        metadata: {
          sourceSurface: "logistics_company_application",
          productModule: "logistics_network",
          diditIdentityStatus: identityStatus,
        },
      }, IdSchema);
    },
    onSuccess: async () => {
      setError(null);
      setMessage("Application submitted. SKIMA will review the documents and make the final approval decision. You can still edit the application while its review is open.");
      setEditing(false);
      await Promise.all([
        applications.refetch(),
        payloadVersions.refetch(),
        client.invalidateQueries({ queryKey: ["skima-logistics", "applications"] }),
      ]);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "The application could not be submitted."),
  });

  const busy = createApplication.isPending || saveApplication.isPending ||
    uploadDocument.isPending || submitApplication.isPending || acceptTerms.isPending;
  const loading = types.isPending || applications.isPending || requirements.isPending || documents.isPending;
  if (loading) {
    return (
      <Card padding="lg">
        <Text style={[styles.heading, { color: palette.ink }]}>Company application</Text>
        <Text style={[styles.copy, { color: palette.muted }]}>Loading SKIMA's current application and document requirements…</Text>
      </Card>
    );
  }
  if (types.error || applications.error || requirements.error || documents.error) {
    return (
      <Card padding="lg">
        <Text style={[styles.heading, { color: palette.ink }]}>Company application</Text>
        <Text style={[styles.copy, { color: palette.muted }]}>The application could not be loaded. Refresh the company workspace and try again.</Text>
        <AppButton size="sm" variant="secondary" label="Retry" onPress={() => void Promise.all([
          types.refetch(), applications.refetch(), requirements.refetch(), documents.refetch(),
          payloadVersions.refetch(), verification.refetch(), policy.refetch(), acceptedPolicy.refetch(),
        ])} />
      </Card>
    );
  }
  if (!applicationTypeId || !requirementSetId) {
    return (
      <Card padding="lg">
        <Text style={[styles.heading, { color: palette.ink }]}>Company application</Text>
        <Text style={[styles.copy, { color: palette.muted }]}>SKIMA has not enabled Logistics company applications yet.</Text>
      </Card>
    );
  }

  const requiredIdentity = configuredRequirements.find((item) =>
    asString(item, "key") === "logistics.company.owner-identity"
  );
  const requiredIdentityId = asString(requiredIdentity, "id");
  const identityDocuments = (documents.data ?? []).filter((document) =>
    asString(document, "application_id") === applicationId &&
    (asString(document, "requirement_id") === requiredIdentityId ||
      asString(record(document.metadata), "requirement_key") === "logistics.company.owner-identity")
  );
  const identityEvidenceUploaded = identityDocuments.some((document) =>
    !["rejected", "expired", "deleted"].includes(asString(document, "status") ?? "")
  );
  const termsAccepted = acceptedPolicy.data === true;
  const currentPolicyTitle = asString(policy.data, "title") ?? "SKIMA Partner Participation Terms";
  const currentPolicySummary = asString(policy.data, "summary") ??
    "These terms explain partner application, approval, service matching, safety, earnings, privacy and conduct.";
  const policySourceUrl = asString(policy.data, "sourceUrl", "source_url");
  const canSubmit = canEdit && !busy && identityEvidenceUploaded && termsAccepted &&
    (identityPassed || identityEvidenceUploaded);
  const showApplicantFields = !applicationId || editing;

  return (
    <View style={styles.section}>
      <SectionHeader
        title="Company application"
        description="Submit the responsible person's identity and your business evidence. CAC registration is optional; SKIMA makes the final approval decision."
      />
      {!applicationId ? (
        <Card padding="lg">
          <Text style={[styles.heading, { color: palette.ink }]}>Start company application</Text>
          <Text style={[styles.copy, { color: palette.muted }]}>
            The applicant is the person registering this company on SKIMA's behalf. Their NIN and identity document are required. A CAC certificate is not compulsory.
          </Text>
          <AppField label="Applicant full name" value={applicantName} onChangeText={setApplicantName}
            autoCapitalize="words" placeholder="Full name as shown on the identity document" />
          <AppField label="Applicant NIN" value={nin} onChangeText={(value) => setNin(value.replace(/\D/g, "").slice(0, 11))}
            keyboardType="number-pad" maxLength={11} placeholder="11-digit National Identification Number"
            hint="Stored in the private application record; not shown on the public company profile." />
          <Text style={[styles.registrationLabel, { color: palette.ink }]}>CAC / company registration</Text>
          <Text style={[styles.copy, { color: palette.muted }]}>Registration proof is optional, including where the business is not yet registered.</Text>
          <View style={styles.registrationChoices}>
            {([
              ["registered", "Registered"],
              ["in_progress", "In progress"],
              ["not_registered", "Not registered"],
            ] as const).map(([value, label]) => (
              <AppButton key={value} size="sm" variant={registrationStatus === value ? "primary" : "secondary"}
                label={label} onPress={() => setRegistrationStatus(value)} disabled={busy} />
            ))}
          </View>
          <AppButton label="Start company application" fullWidth loading={createApplication.isPending}
            disabled={busy || !organizationId || !applicantName.trim() || !isValidNin(nin)}
            onPress={() => { setError(null); createApplication.mutate(); }} />
        </Card>
      ) : (
        <>
          <Card padding="lg">
            <View style={styles.statusRow}>
              <View style={styles.statusCopy}>
                <Text style={[styles.heading, { color: palette.ink }]}>Application {applicationId.slice(0, 8).toUpperCase()}</Text>
                <Text style={[styles.copy, { color: palette.muted }]}>
                  {isTerminal(applicationStatus)
                    ? "SKIMA has made its decision on this application."
                    : applicationStatus === "submitted" || applicationStatus === "under_review"
                      ? "Your application is with SKIMA for final review."
                      : "Complete your application and submit it for SKIMA's review."}
                </Text>
              </View>
              <View style={styles.applicationBadges}>
                <StatusPill status={applicationStatus} />
                <StatusPill status={registrationStatus} />
              </View>
            </View>
            {!isTerminal(applicationStatus) ? (
              <Text style={[styles.copy, { color: palette.muted }]}>
                CAC registration documents are optional. Your application remains editable while SKIMA's review is open; only SKIMA can approve or reject it.
              </Text>
            ) : (
              <Text style={[styles.copy, { color: palette.muted }]}>The applicant can no longer edit a finalised application. Contact SKIMA if a new application is needed.</Text>
            )}
            {canEdit && !editing ? (
              <AppButton size="sm" variant="secondary" label="Edit application details" onPress={() => setEditing(true)} />
            ) : null}
          </Card>

          {showApplicantFields ? (
            <Card padding="lg">
              <Text style={[styles.heading, { color: palette.ink }]}>Applicant identity</Text>
              <AppField label="Applicant full name" value={applicantName} onChangeText={setApplicantName}
                editable={canEdit} autoCapitalize="words" placeholder="Full name as shown on the identity document" />
              <AppField label="Applicant NIN" value={nin} onChangeText={(value) => setNin(value.replace(/\D/g, "").slice(0, 11))}
                editable={canEdit} keyboardType="number-pad" maxLength={11} placeholder="11-digit National Identification Number"
                hint="Kept private in the application record and used for identity review." />
              <Text style={[styles.registrationLabel, { color: palette.ink }]}>CAC / company registration status</Text>
              <View style={styles.registrationChoices}>
                {([
                  ["registered", "Registered"],
                  ["in_progress", "In progress"],
                  ["not_registered", "Not registered"],
                ] as const).map(([value, label]) => (
                  <AppButton key={value} size="sm" variant={registrationStatus === value ? "primary" : "secondary"}
                    label={label} onPress={() => setRegistrationStatus(value)} disabled={!canEdit || busy} />
                ))}
              </View>
              {canEdit ? (
                <AppButton label="Save application details" fullWidth loading={saveApplication.isPending}
                  disabled={busy || !applicantName.trim() || !isValidNin(nin)}
                  onPress={() => saveApplication.mutate()} />
              ) : null}
            </Card>
          ) : null}

          <Card padding="lg">
            <View style={styles.statusRow}>
              <View style={styles.statusCopy}>
                <Text style={[styles.heading, { color: palette.ink }]}>Secure identity verification</Text>
                <Text style={[styles.copy, { color: palette.muted }]}>
                  {identityPassed
                    ? "The applicant's identity check has passed."
                    : "Complete the hosted Didit identity and liveness check, then return here to confirm the result."}
                </Text>
              </View>
              <StatusPill status={identityStatus} />
            </View>
            {identityPassed ? (
              <Text style={[styles.copy, { color: palette.success }]}>Identity verified. Keep the requested identity evidence attached for SKIMA's review record.</Text>
            ) : (
              <AppButton size="sm" variant="secondary" label={identitySessionId ? "Open secure check" : "Start Didit identity check"}
                loading={verificationBusy} disabled={!canEdit || verificationBusy}
                onPress={() => void startIdentityVerification()} />
            )}
            {identitySessionId && !identityPassed ? (
              <AppButton size="sm" variant="ghost" label="Check verification result"
                loading={verificationBusy} disabled={verificationBusy}
                onPress={() => void refreshIdentityVerification()} />
            ) : null}
            {verificationMessage || asString(identityCheck, "failureMessage", "failure_message") ? (
              <Text style={[styles.copy, { color: palette.muted }]}>
                {verificationMessage ?? asString(identityCheck, "failureMessage", "failure_message")}
              </Text>
            ) : null}
            {!identityAvailable ? (
              <Text style={[styles.copy, { color: palette.muted }]}>Automatic verification is unavailable. Upload the applicant's required identity document; SKIMA can review the evidence manually.</Text>
            ) : null}
          </Card>

          {configuredRequirements.map((requirement) => {
            const requirementId = asString(requirement, "id");
            const key = asString(requirement, "key") ?? "";
            const submitted = (documents.data ?? []).filter((document) =>
              asString(document, "application_id") === applicationId &&
              (asString(document, "requirement_id") === requirementId ||
                asString(record(document.metadata), "requirement_key") === key)
            );
            const latest = submitted[0] ?? null;
            const activeUpload = uploadingKey === key;
            const required = requirement.is_required === true || Number(requirement.min_count ?? 0) > 0;
            return (
              <Card key={requirementId ?? key} padding="md">
                <View style={styles.statusRow}>
                  <View style={styles.statusCopy}>
                    <Text style={[styles.documentTitle, { color: palette.ink }]}>{asString(requirement, "display_name") ?? key}</Text>
                    <Text style={[styles.copy, { color: palette.muted }]}>{asString(requirement, "description") ?? "Private evidence for SKIMA's review."}</Text>
                    <Text style={[styles.documentStatus, { color: palette.muted }]}>
                      {latest ? "Uploaded · " + (asString(latest, "status") ?? "received") : required ? "Required · not uploaded" : "Optional · not uploaded"}
                    </Text>
                  </View>
                  {canEdit ? (
                    <AppButton size="sm" variant="secondary" label={activeUpload ? "Uploading…" : latest ? "Replace" : "Upload"}
                      disabled={busy} loading={activeUpload}
                      onPress={() => {
                        setError(null);
                        setUploadingKey(key);
                        uploadDocument.mutate(requirement, { onSettled: () => setUploadingKey(null) });
                      }} />
                  ) : null}
                </View>
              </Card>
            );
          })}

          <Card padding="lg">
            <Text style={[styles.heading, { color: palette.ink }]}>{currentPolicyTitle}</Text>
            <Text style={[styles.copy, { color: palette.muted }]}>{currentPolicySummary}</Text>
            {policySourceUrl ? (
              <Pressable onPress={() => void Linking.openURL(policySourceUrl)}>
                <Text style={[styles.policyLink, { color: palette.brand }]}>Read the full partner terms</Text>
              </Pressable>
            ) : null}
            {termsAccepted ? (
              <Text style={[styles.copy, { color: palette.success }]}>Current partner terms accepted.</Text>
            ) : (
              <>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: policyConfirmed }}
                  onPress={() => setPolicyConfirmed((value) => !value)} style={styles.policyCheckbox}>
                  <View style={[styles.checkbox, { borderColor: policyConfirmed ? palette.brand : palette.borderStrong, backgroundColor: policyConfirmed ? palette.brand : palette.surface }]}>
                    {policyConfirmed ? <Text style={styles.checkboxTick}>✓</Text> : null}
                  </View>
                  <Text style={[styles.copy, { color: palette.ink }]}>
                    {asString(policy.data, "acceptanceStatement") ?? "I have read and agree to the SKIMA Partner Participation Terms applicable to this company."}
                  </Text>
                </Pressable>
                <AppButton size="sm" variant="secondary" label="Accept partner terms"
                  loading={acceptTerms.isPending} disabled={!canEdit || busy || !policyConfirmed || !policy.data?.published}
                  onPress={() => acceptTerms.mutate()} />
              </>
            )}
            {policy.error || acceptedPolicy.error ? (
              <Text style={[styles.copy, { color: palette.danger }]}>SKIMA could not check the current partner terms. Retry before submitting.</Text>
            ) : null}
          </Card>

          {canEdit ? (
            <Card padding="lg">
              <Text style={[styles.heading, { color: palette.ink }]}>Submit for SKIMA review</Text>
              <Text style={[styles.copy, { color: palette.muted }]}>
                Submit after saving your applicant details, uploading the required identity document and accepting the current partner terms. CAC evidence remains optional. SKIMA's authorised reviewers make the final decision.
              </Text>
              <AppButton label={applicationStatus === "additional_info_required" ? "Resubmit application" : "Submit company application"}
                fullWidth loading={submitApplication.isPending} disabled={!canSubmit || busy}
                onPress={() => submitApplication.mutate()} />
              {!identityEvidenceUploaded ? (
                <Text style={[styles.copy, { color: palette.danger }]}>Upload the applicant's identity document before submission.</Text>
              ) : null}
              {!termsAccepted ? (
                <Text style={[styles.copy, { color: palette.muted }]}>Accept the current SKIMA Partner Participation Terms before submission.</Text>
              ) : null}
            </Card>
          ) : null}
        </>
      )}
      {message ? <Text style={[styles.copy, { color: palette.success }]}>{message}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  heading: { ...typography.bodyStrong, fontSize: 14 },
  documentTitle: { ...typography.bodyStrong, fontSize: 12 },
  copy: { ...typography.caption, fontSize: 10, lineHeight: 15 },
  documentStatus: { ...typography.caption, fontSize: 9, fontWeight: "700" },
  registrationLabel: { ...typography.caption, fontSize: 10, fontWeight: "900", marginTop: spacing.sm },
  registrationChoices: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  applicationBadges: { alignItems: "flex-end", gap: 5 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  statusCopy: { flex: 1, minWidth: 0, gap: 4 },
  error: { ...typography.caption, fontSize: 10, lineHeight: 15 },
  policyLink: { fontSize: 11, fontWeight: "900", marginTop: 8 },
  policyCheckbox: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginTop: 10 },
  checkbox: { width: 23, height: 23, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  checkboxTick: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
});
