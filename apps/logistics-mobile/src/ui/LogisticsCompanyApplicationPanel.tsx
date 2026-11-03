import * as DocumentPicker from "expo-document-picker";
import { File, UploadType } from "expo-file-system";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClientIdempotencyKey } from "@skima/frontend-core";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { asString, useLogisticsQuery } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { Card } from "./Card";
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "./StatusPill";

type Row = Record<string, unknown>;
const IdSchema = z.string().uuid();
const UploadSessionSchema = z.object({
  signedUrl: z.string().url(),
  method: z.literal("PUT"),
  storageBucket: z.string(),
  storagePath: z.string(),
});

function record(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

export function LogisticsCompanyApplicationPanel({
  organizationId,
  displayName,
  legalName,
}: {
  organizationId: string;
  displayName: string;
  legalName: string | null;
}) {
  const { palette } = useAppTheme();
  const { api, session } = useSession();
  const client = useQueryClient();
  const types = useLogisticsQuery(["application-types"], "/runtime/application-types", true, 120_000);
  const applications = useLogisticsQuery(["applications"], "/runtime/applications", true, 45_000);
  const requirements = useLogisticsQuery(["document-requirements"], "/runtime/documents/requirements", true, 120_000);
  const documents = useLogisticsQuery(["documents"], "/runtime/documents", true, 30_000);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const applicationType = types.data?.find((item) => asString(item, "key") === "application.logistics.company") ?? null;
  const applicationTypeId = asString(applicationType, "id");
  const requirementSetId = asString(applicationType, "document_requirement_set_id");
  const application = useMemo(() => (applications.data ?? [])
    .filter((item) => asString(item, "application_type_id") === applicationTypeId &&
      asString(item, "organization_id") === organizationId)
    .sort((left, right) => Date.parse(asString(right, "created_at") ?? "") - Date.parse(asString(left, "created_at") ?? ""))[0] ?? null,
  [applications.data, applicationTypeId, organizationId]);
  const applicationId = asString(application, "id");
  const configuredRequirements = useMemo(() => (requirements.data ?? [])
    .filter((item) => asString(item, "requirement_set_id") === requirementSetId &&
      asString(item, "status") === "active")
    .sort((left, right) => (asString(left, "display_name") ?? "").localeCompare(asString(right, "display_name") ?? "")),
  [requirements.data, requirementSetId]);

  const createApplication = useMutation({
    mutationFn: () => api.post("/runtime/applications", {
      applicationTypeKey: "application.logistics.company",
      organizationId,
      idempotencyKey: createClientIdempotencyKey("logistics.company.application", organizationId),
      source: "skima.logistics.company.application",
      payload: {
        organization: {
          organizationId,
          displayName,
          legalName,
          registrationStatus: legalName ? "provided" : "not_registered_or_not_provided",
          registrationEvidenceOptional: true,
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
      },
    }, IdSchema),
    onSuccess: async () => {
      setError(null);
      await client.invalidateQueries({ queryKey: ["skima-logistics", "applications"] });
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "The company application could not be started."),
  });

  const uploadDocument = useMutation({
    mutationFn: async (requirement: Row) => {
      if (!applicationId || !session?.user.id) throw new Error("Start the company application before adding evidence.");
      const requirementKey = asString(requirement, "key");
      if (!requirementKey) throw new Error("This document requirement is missing its key.");
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return null;

      const asset = picked.assets[0];
      const contentType = asset.mimeType && (
        asset.mimeType === "application/pdf" || asset.mimeType.startsWith("image/")
      ) ? asset.mimeType : "application/octet-stream";
      const extension = asset.name.includes(".") ? asset.name.split(".").pop()?.toLowerCase() : "bin";
      const idempotencyKey = createClientIdempotencyKey(
        "logistics.company.document",
        `${applicationId}:${requirementKey}:${Date.now()}`,
      );
      const uploadSession = await api.post("/runtime/media/upload-sessions", {
        contentType,
        fileName: asset.name || `${requirementKey}.${extension ?? "bin"}`,
        idempotencyKey,
        storageBucket: "skima-platform-documents",
      }, UploadSessionSchema);
      const file = new File(asset.uri);
      const result = await file.createUploadTask(uploadSession.signedUrl, {
        httpMethod: "PUT",
        uploadType: UploadType.BINARY_CONTENT,
        mimeType: contentType,
        headers: { "content-type": contentType },
        sessionType: "background",
      }).uploadAsync();
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`The document upload was rejected (${result.status}).`);
      }
      return api.post("/runtime/documents", {
        applicationId,
        requirementKey,
        byteSize: asset.size ?? file.size,
        contentType,
        idempotencyKey: `${idempotencyKey}:submission`,
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
      await Promise.all([
        client.invalidateQueries({ queryKey: ["skima-logistics", "documents"] }),
        documents.refetch(),
      ]);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "The document could not be uploaded."),
  });

  const busy = createApplication.isPending || uploadDocument.isPending;
  if (types.isPending || applications.isPending || requirements.isPending || documents.isPending) {
    return (
      <Card padding="lg">
        <Text style={[styles.heading, { color: palette.ink }]}>Company application evidence</Text>
        <Text style={[styles.copy, { color: palette.muted }]}>Loading the current SKIMA document requirements…</Text>
      </Card>
    );
  }
  if (types.error || applications.error || requirements.error || documents.error) {
    return (
      <Card padding="lg">
        <Text style={[styles.heading, { color: palette.ink }]}>Company application evidence</Text>
        <Text style={[styles.copy, { color: palette.muted }]}>The application requirements could not be loaded. Refresh the company workspace and try again.</Text>
        <AppButton size="sm" variant="secondary" label="Retry" onPress={() => void Promise.all([types.refetch(), applications.refetch(), requirements.refetch(), documents.refetch()])} />
      </Card>
    );
  }
  if (!applicationTypeId || !requirementSetId) {
    return (
      <Card padding="lg">
        <Text style={[styles.heading, { color: palette.ink }]}>Company application evidence</Text>
        <Text style={[styles.copy, { color: palette.muted }]}>SKIMA has not enabled the Logistics company application requirements yet.</Text>
      </Card>
    );
  }

  return (
    <View style={styles.section}>
      <SectionHeader title="Company application" description="Attach business evidence for SKIMA's final review. Documents are private and visible only to authorised reviewers." />
      {!application ? (
        <Card padding="lg">
          <Text style={[styles.heading, { color: palette.ink }]}>Start company application</Text>
          <Text style={[styles.copy, { color: palette.muted }]}>
            You can apply even when the company is not CAC-registered. Registration evidence is optional; SKIMA will review the company and make the final approval decision.
          </Text>
          <AppButton label="Start company application" fullWidth loading={createApplication.isPending}
            disabled={busy || !organizationId} onPress={() => { setError(null); createApplication.mutate(); }} />
        </Card>
      ) : (
        <>
          <Card padding="lg">
            <View style={styles.statusRow}>
              <View style={styles.statusCopy}>
                <Text style={[styles.heading, { color: palette.ink }]}>Application evidence</Text>
                <Text style={[styles.copy, { color: palette.muted }]}>Application {applicationId?.slice(0, 8).toUpperCase()}</Text>
              </View>
              <StatusPill status={asString(application, "status") ?? "draft"} />
            </View>
            <Text style={[styles.copy, { color: palette.muted }]}>
              Registration proof is optional. You may leave it empty and continue operating as an unregistered applicant while SKIMA reviews your company identity and operating information.
            </Text>
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
            return (
              <Card key={requirementId ?? key} padding="md">
                <View style={styles.statusRow}>
                  <View style={styles.statusCopy}>
                    <Text style={[styles.documentTitle, { color: palette.ink }]}>{asString(requirement, "display_name") ?? key}</Text>
                    <Text style={[styles.copy, { color: palette.muted }]}>{asString(requirement, "description") ?? "Optional evidence for SKIMA's company review."}</Text>
                    <Text style={[styles.documentStatus, { color: palette.muted }]}>
                      {latest ? "Uploaded · " + (asString(latest, "status") ?? "received") : "Optional · not uploaded"}
                    </Text>
                  </View>
                  <AppButton size="sm" variant="secondary" label={activeUpload ? "Uploading…" : latest ? "Replace" : "Upload"}
                    disabled={busy} loading={activeUpload}
                    onPress={() => {
                      setError(null);
                      setUploadingKey(key);
                      uploadDocument.mutate(requirement, { onSettled: () => setUploadingKey(null) });
                    }} />
                </View>
              </Card>
            );
          })}
        </>
      )}
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
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  statusCopy: { flex: 1, minWidth: 0, gap: 4 },
  error: { ...typography.caption, fontSize: 10, lineHeight: 15 },
});
