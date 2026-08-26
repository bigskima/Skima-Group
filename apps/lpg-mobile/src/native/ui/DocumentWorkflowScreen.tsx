import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { AlertCircle, CheckCircle2, FileCheck2, Send, Upload } from "lucide-react-native";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  displayStatus,
  firstNumber,
  firstString,
  recordId,
  type PlatformRecord,
} from "../api/records";
import { uploadFileToRuntime } from "../media/upload";
import { useSession } from "../session/SessionProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { idempotencyKey } from "../utilities/idempotency";
import { friendlyError } from "../utilities/friendlyError";
import { Card } from "./Card";
import { Screen } from "./Screen";

const NON_READY_DOCUMENT_STATUSES = new Set([
  "correction_required",
  "rejected",
  "expired",
  "withdrawn",
  "quarantined",
]);

const CORRECTION_APPLICATION_STATUSES = new Set([
  "additional_info_required",
  "changes_requested",
  "incomplete",
]);

export function DocumentWorkflowScreen({
  workspace,
}: {
  workspace: "driver" | "station" | "vehicle";
}) {
  const session = useSession();
  const applications = domainQueries.applications();
  const types = domainQueries.applicationTypes();
  const requirements = domainQueries.documentRequirements();
  const documents = domainQueries.documents();
  const category = workspace === "station" ? "business" : workspace;
  const type = (types.data ?? []).find(
    (item) =>
      firstString(item, ["application_category", "applicationCategory"]) ===
        category && firstString(item, ["status"]) === "active",
  );
  const typeId = type ? recordId(type) : null;
  const application = (applications.data ?? [])
    .filter(
      (item) =>
        firstString(item, ["application_type_id", "applicationTypeId"]) ===
          typeId &&
        !["rejected", "withdrawn", "expired"].includes(
          firstString(item, ["status"]) ?? "",
        ),
    )
    .sort((a, b) => timestampOf(b) - timestampOf(a))[0];
  const applicationId = application ? recordId(application) : null;
  const requirementSetId = firstString(type, [
    "document_requirement_set_id",
    "documentRequirementSetId",
  ]);
  const configured = useMemo(
    () =>
      (requirements.data ?? []).filter(
        (item) =>
          firstString(item, ["requirement_set_id", "requirementSetId"]) ===
            requirementSetId && firstString(item, ["status"]) === "active",
      ),
    [requirementSetId, requirements.data],
  );
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [uploadedKeys, setUploadedKeys] = useState<ReadonlySet<string>>(new Set());
  const register = useGatewayMutation({
    path: "/runtime/documents",
    schema: ActionResponseSchema,
    invalidate: [["documents"]],
  });
  const submit = useGatewayMutation({
    path: "/runtime/applications/submit",
    schema: ActionResponseSchema,
    invalidate: [["applications"], ["documents"], ["messages"]],
  });

  const existingForRequirement = (requirement: PlatformRecord) => {
    const requirementId = recordId(requirement);
    const requirementKey = firstString(requirement, ["key"]);
    return (documents.data ?? [])
      .filter(
        (document) =>
          firstString(document, ["application_id", "applicationId"]) ===
            applicationId &&
          (firstString(document, ["requirement_id", "requirementId"]) ===
            requirementId ||
            firstString(document, [
              "requirement_key",
              "requirementKey",
            ]) === requirementKey),
      )
      .sort((a, b) => timestampOf(b) - timestampOf(a));
  };

  const latestForRequirement = (requirement: PlatformRecord) =>
    existingForRequirement(requirement)[0] ?? null;

  const requirementKeyOf = (requirement: PlatformRecord) =>
    firstString(requirement, ["key"]) ?? recordId(requirement) ?? "";

  const requirementNeedsReplacement = (requirement: PlatformRecord) => {
    const key = requirementKeyOf(requirement);
    if (uploadedKeys.has(key)) return false;
    const latest = latestForRequirement(requirement);
    return latest ? documentNeedsReplacement(latest) : false;
  };

  const requiredConfigured = configured.filter(
    (requirement) => requirement.is_required === true,
  );

  const missingConfigured = requiredConfigured.filter((requirement) => {
    const requirementKey = requirementKeyOf(requirement);
    const minCount = firstNumber(requirement, ["min_count", "minCount"]) ?? 1;
    const existing = existingForRequirement(requirement);
    const latest = existing[0];
    const existingReadyCount = latest && documentNeedsReplacement(latest)
      ? 0
      : existing.filter(documentIsReady).length;
    const optimisticCount = uploadedKeys.has(requirementKey) ? 1 : 0;
    return existingReadyCount + optimisticCount < minCount;
  });

  const outstandingRequested = configured.filter(requirementNeedsReplacement);
  const orderedConfigured = [...configured].sort((a, b) =>
    Number(requirementNeedsReplacement(b)) - Number(requirementNeedsReplacement(a))
  );
  const applicationStatus = firstString(application, ["status"]) ?? "draft";
  const isCorrectionFlow =
    CORRECTION_APPLICATION_STATUSES.has(applicationStatus) || outstandingRequested.length > 0;
  const canSubmitApplication =
    Boolean(applicationId) &&
    requiredConfigured.length > 0 &&
    missingConfigured.length === 0 &&
    ["draft", "incomplete", "additional_info_required", "changes_requested", "resubmitted"].includes(applicationStatus);

  const choose = async (requirement: PlatformRecord) => {
    const key = firstString(requirement, ["key"]);
    if (!key || !applicationId) {
      setMessage("Create the application before uploading its documents.");
      return;
    }
    const allowed = stringArray(
      requirement.allowed_content_types ?? requirement.allowedContentTypes,
    );
    const result = await DocumentPicker.getDocumentAsync({
      type: allowed.length ? allowed : ["image/*", "application/pdf"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const file = result.assets[0];
    const max = firstNumber(requirement, ["max_byte_size", "maxByteSize"]);
    if (max !== null && file.size && file.size > max) {
      setMessage(`This file exceeds the configured ${formatBytes(max)} limit.`);
      return;
    }
    setUploading(key);
    setUploadProgress(0);
    setMessage(null);
    try {
      const uploaded = await uploadFileToRuntime({
        api: session.api,
        uri: file.uri,
        fileName: file.name,
        contentType: file.mimeType ?? "application/octet-stream",
        scope: `application-document-${key}`,
        onProgress: setUploadProgress,
      });
      await register.mutateAsync({
        applicationId,
        requirementKey: key,
        storageBucket: uploaded.storageBucket,
        storagePath: uploaded.storagePath,
        contentType: uploaded.contentType,
        byteSize: uploaded.byteSize,
        metadata: { originalFileName: file.name, source: "skima.lpg.mobile" },
        idempotencyKey: `${uploaded.idempotencyKey}:register`,
      });
      setUploadedKeys((current) => new Set([...current, key]));
      await documents.refetch();
      setMessage(
        `${firstString(requirement, ["display_name", "displayName"]) ?? key} uploaded successfully.`,
      );
    } catch (cause) {
      setMessage(friendlyError(cause, "The document could not be uploaded. Please try again."));
    } finally {
      setUploading(null);
      setUploadProgress(0);
    }
  };

  const submitApplication = async () => {
    if (!applicationId || !canSubmitApplication) return;
    setMessage(null);
    try {
      await submit.mutateAsync({
        applicationId,
        idempotencyKey: idempotencyKey(
          `${workspace}-application-submit-documents`,
          applicationId,
        ),
      });
      setMessage(isCorrectionFlow ? "Updates submitted for review." : "Application submitted for review.");
      router.replace(`/(customer)/${workspace}-application` as never);
    } catch (cause) {
      setMessage(friendlyError(cause, "The application could not be submitted. Please try again."));
    }
  };

  const loading =
    applications.isPending ||
    types.isPending ||
    requirements.isPending ||
    documents.isPending;

  return (
    <Screen
      eyebrow={isCorrectionFlow ? "Application update" : "Required documents"}
      title={isCorrectionFlow ? "Requested Updates" : "Documents"}
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
      }
    >
      {loading ? (
        <ActivityIndicator color={colors.brand} />
      ) : !applicationId ? (
        <Card>
          <Text style={styles.title}>Application required</Text>
          <Text style={styles.body}>
            Start your {workspace} application first to see the documents you
            need to provide.
          </Text>
          <Pressable
            style={styles.primary}
            onPress={() =>
              router.push(
                workspace === "vehicle"
                  ? "/(driver)/vehicles"
                  : (`/${workspace === "driver" ? "(driver)" : "(station)"}/application` as never),
              )
            }
          >
            <Text style={styles.primaryText}>Open application</Text>
          </Pressable>
        </Card>
      ) : (
        <>
          <View style={[styles.hero, isCorrectionFlow && styles.heroCorrection]}>
            {isCorrectionFlow ? (
              <AlertCircle color="white" size={28} />
            ) : (
              <FileCheck2 color="white" size={28} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>
                {isCorrectionFlow ? "Reviewer requested an update" : "Verification documents"}
              </Text>
              <Text style={styles.heroBody}>
                {isCorrectionFlow
                  ? outstandingRequested.length > 0
                    ? `${outstandingRequested.length} item${outstandingRequested.length === 1 ? "" : "s"} still need attention. Requested items appear first.`
                    : "Your requested replacements are ready. Review them and resubmit when complete."
                  : `${configured.length} active requirement${configured.length === 1 ? "" : "s"} for this application.`}
              </Text>
            </View>
          </View>

          {orderedConfigured.map((requirement, index) => {
            const existing = existingForRequirement(requirement);
            const latest = existing[0] ?? null;
            const key = firstString(requirement, ["key"]) ?? String(index);
            const requested = requirementNeedsReplacement(requirement);
            const replacementUploaded = uploadedKeys.has(key);
            const reason = latest ? reviewReason(latest) : null;
            const status = replacementUploaded
              ? "Replacement uploaded"
              : latest
                ? (displayStatus(latest) ?? "submitted").replace(/[_-]/g, " ")
                : "Awaiting upload";

            return (
              <Card key={key}>
                <View style={styles.row}>
                  <View style={{ flex: 1, gap: 6 }}>
                    <View style={styles.titleRow}>
                      <Text style={styles.title}>
                        {firstString(requirement, [
                          "display_name",
                          "displayName",
                        ]) ?? key}
                      </Text>
                      {requested ? (
                        <View style={styles.requestedBadge}>
                          <Text style={styles.requestedBadgeText}>Update required</Text>
                        </View>
                      ) : replacementUploaded ? (
                        <CheckCircle2 color={colors.success} size={18} />
                      ) : null}
                    </View>
                    <Text style={styles.body}>
                      {requirement.is_required === true ? "Required" : "Optional"}
                      {existing.length ? ` · ${existing.length} file${existing.length === 1 ? "" : "s"} on record` : ""}
                      {firstNumber(requirement, ["max_count", "maxCount"])
                        ? ` · up to ${firstNumber(requirement, ["max_count", "maxCount"])} files`
                        : ""}
                    </Text>
                    {firstString(requirement, ["description"]) ? (
                      <Text style={styles.body}>
                        {firstString(requirement, ["description"])}
                      </Text>
                    ) : null}

                    {requested ? (
                      <View style={styles.correctionBox}>
                        <AlertCircle color={colors.danger} size={18} />
                        <View style={styles.correctionCopy}>
                          <Text style={styles.correctionTitle}>Replace this file</Text>
                          <Text style={styles.correctionText}>
                            {reason ?? "The reviewer asked for a new copy of this document before review can continue."}
                          </Text>
                        </View>
                      </View>
                    ) : null}

                    <Text style={[styles.status, requested && styles.statusDanger]}>{status}</Text>
                    {uploading === key ? (
                      <Text style={styles.progress}>
                        Uploading {Math.round(uploadProgress * 100)}%
                      </Text>
                    ) : null}
                  </View>

                  <Pressable
                    accessibilityLabel={`${requested ? "Replace" : "Upload"} ${firstString(requirement, ["display_name", "displayName"]) ?? key}`}
                    disabled={uploading !== null}
                    onPress={() => void choose(requirement)}
                    style={[styles.upload, requested && styles.uploadRequested]}
                  >
                    {uploading === key ? (
                      <ActivityIndicator color={requested ? "white" : colors.brand} />
                    ) : (
                      <>
                        <Upload color={requested ? "white" : colors.brand} size={19} />
                        <Text style={[styles.uploadText, requested && styles.uploadTextRequested]}>
                          {requested ? "Replace" : existing.length ? "Add file" : "Upload"}
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </Card>
            );
          })}

          {configured.length === 0 ? (
            <Text style={styles.body}>
              No active document requirements were returned by the approval
              policy.
            </Text>
          ) : null}

          {configured.length > 0 ? (
            <Card>
              <View style={styles.row}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.title}>
                    {canSubmitApplication
                      ? isCorrectionFlow
                        ? "Ready to resubmit"
                        : "Ready for admin review"
                      : outstandingRequested.length > 0
                        ? "Complete requested updates"
                        : "Complete required documents"}
                  </Text>
                  <Text style={styles.body}>
                    {canSubmitApplication
                      ? isCorrectionFlow
                        ? "The requested files have been replaced. Submit your updates so review can continue."
                        : "All required files are present. Submit now without leaving this screen."
                      : outstandingRequested.length > 0
                        ? `${outstandingRequested.length} reviewer-requested item${outstandingRequested.length === 1 ? "" : "s"} still need to be replaced.`
                        : `${missingConfigured.length} required item${missingConfigured.length === 1 ? "" : "s"} still needed before submission.`}
                  </Text>
                </View>
                {canSubmitApplication ? <FileCheck2 color={colors.success} /> : null}
              </View>
              {canSubmitApplication ? (
                <Pressable
                  disabled={submit.isPending}
                  onPress={() => void submitApplication()}
                  style={styles.primary}
                >
                  {submit.isPending ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <Send color="white" size={18} />
                      <Text style={styles.primaryText}>
                        {isCorrectionFlow ? "Submit updates for review" : "Submit application for review"}
                      </Text>
                    </>
                  )}
                </Pressable>
              ) : null}
            </Card>
          ) : null}
        </>
      )}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </Screen>
  );
}

function timestampOf(record: PlatformRecord) {
  const value = firstString(record, ["updated_at", "updatedAt", "created_at", "createdAt"]);
  const timestamp = value ? Date.parse(value) : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function documentNeedsReplacement(document: PlatformRecord) {
  const status = firstString(document, ["status"]) ?? "";
  return Boolean(document.replacement_requested) ||
    status === "correction_required" ||
    status === "rejected";
}

function documentIsReady(document: PlatformRecord) {
  const status = firstString(document, ["status"]) ?? "uploaded";
  return !NON_READY_DOCUMENT_STATUSES.has(status) && !Boolean(document.replacement_requested);
}

function reviewReason(document: PlatformRecord) {
  return firstString(document, [
    "replacement_reason",
    "replacementReason",
    "decision_reason",
    "decisionReason",
  ]);
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  back: { color: colors.brand, fontWeight: "800" },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: colors.brand,
  },
  heroCorrection: { backgroundColor: colors.danger },
  heroTitle: { color: "white", fontSize: 20, fontWeight: "900" },
  heroBody: { color: "#FFF1F2", marginTop: 4, lineHeight: 19 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs },
  title: { color: colors.ink, fontSize: 17, fontWeight: "900", flexShrink: 1 },
  body: { color: colors.muted, lineHeight: 20 },
  requestedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: "#FEE2E2",
  },
  requestedBadgeText: { color: colors.danger, fontSize: 11, fontWeight: "900" },
  correctionBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginTop: spacing.xs,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: "#FEF2F2",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#FECACA",
  },
  correctionCopy: { flex: 1, gap: 2 },
  correctionTitle: { color: colors.danger, fontWeight: "900", fontSize: 13 },
  correctionText: { color: colors.ink, fontSize: 12, lineHeight: 18 },
  status: {
    color: colors.brandDark,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  statusDanger: { color: colors.danger },
  progress: { color: colors.brand, fontWeight: "900" },
  upload: {
    minWidth: 82,
    minHeight: 50,
    paddingHorizontal: 10,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    backgroundColor: "#FFF0F1",
  },
  uploadRequested: { backgroundColor: colors.danger },
  uploadText: { color: colors.brand, fontSize: 11, fontWeight: "900" },
  uploadTextRequested: { color: "white" },
  primary: {
    minHeight: 52,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  primaryText: { color: "white", fontWeight: "900" },
  message: { color: colors.brandDark, fontWeight: "700" },
});
