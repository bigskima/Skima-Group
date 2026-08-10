import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { FileCheck2, Upload } from "lucide-react-native";
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
import { Card } from "./Card";
import { Screen } from "./Screen";
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
  const application = (applications.data ?? []).find(
    (item) =>
      firstString(item, ["application_type_id", "applicationTypeId"]) ===
        typeId &&
      !["rejected", "withdrawn", "expired"].includes(
        firstString(item, ["status"]) ?? "",
      ),
  );
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
  const register = useGatewayMutation({
    path: "/runtime/documents",
    schema: ActionResponseSchema,
    invalidate: [["documents"]],
  });
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
      setMessage(
        `${firstString(requirement, ["display_name", "displayName"]) ?? key} uploaded securely.`,
      );
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Document upload failed.",
      );
    } finally {
      setUploading(null);
      setUploadProgress(0);
    }
  };
  const loading =
    applications.isPending ||
    types.isPending ||
    requirements.isPending ||
    documents.isPending;
  return (
    <Screen
      eyebrow="Verification evidence"
      title="Documents"
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
            Start your {workspace} application first. Its backend policy
            determines which documents are accepted.
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
          <View style={styles.hero}>
            <FileCheck2 color="white" size={28} />
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>Policy-driven verification</Text>
              <Text style={styles.heroBody}>
                {configured.length} active requirements · application{" "}
                {(displayStatus(application!) ?? "draft").replace(/[_-]/g, " ")}
              </Text>
            </View>
          </View>
          {configured.map((requirement, index) => {
            const requirementId = recordId(requirement);
            const existing = (documents.data ?? []).filter(
              (document) =>
                firstString(document, ["application_id", "applicationId"]) ===
                  applicationId &&
                (firstString(document, ["requirement_id", "requirementId"]) ===
                  requirementId ||
                  firstString(document, [
                    "requirement_key",
                    "requirementKey",
                  ]) === firstString(requirement, ["key"])),
            );
            const key = firstString(requirement, ["key"]) ?? String(index);
            return (
              <Card key={key}>
                <View style={styles.row}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.title}>
                      {firstString(requirement, [
                        "display_name",
                        "displayName",
                      ]) ?? key}
                    </Text>
                    <Text style={styles.body}>
                      {requirement.is_required === true
                        ? "Required"
                        : "Optional"}{" "}
                      · {existing.length} submitted
                    </Text>
                    <Text style={styles.status}>
                      {existing.length
                        ? (displayStatus(existing[0]) ?? "submitted").replace(
                            /[_-]/g,
                            " ",
                          )
                        : "Awaiting upload"}
                    </Text>
                    {uploading === key ? (
                      <Text style={styles.progress}>
                        Uploading {Math.round(uploadProgress * 100)}%
                      </Text>
                    ) : null}
                  </View>
                  <Pressable
                    accessibilityLabel={`Upload ${key}`}
                    disabled={uploading !== null}
                    onPress={() => void choose(requirement)}
                    style={styles.upload}
                  >
                    {uploading === key ? (
                      <ActivityIndicator color={colors.brand} />
                    ) : (
                      <Upload color={colors.brand} size={22} />
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
        </>
      )}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </Screen>
  );
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
  heroTitle: { color: "white", fontSize: 20, fontWeight: "900" },
  heroBody: { color: "#FFF1F2", marginTop: 4, textTransform: "capitalize" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  title: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  body: { color: colors.muted, lineHeight: 20 },
  status: {
    color: colors.brandDark,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  progress: { color: colors.brand, fontWeight: "900" },
  upload: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF0F1",
  },
  primary: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  primaryText: { color: "white", fontWeight: "900" },
  message: { color: colors.brandDark, fontWeight: "700" },
});
