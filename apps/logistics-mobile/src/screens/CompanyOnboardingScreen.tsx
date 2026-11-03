import { createClientIdempotencyKey } from "@skima/frontend-core";
import { router } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { File, UploadType } from "expo-file-system";
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, FileText, ShieldCheck, Trash2, Upload } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { AppField } from "../ui/AppField";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";
import { SectionHeader } from "../ui/SectionHeader";

type RegistrationStatus = "registered" | "in_progress" | "not_registered";
type PickedDocument = { uri: string; name: string; mimeType: string; size: number };
type SubmittedDocument = { asset_id: string; file_name: string; content_type: string; byte_size: number };
const UploadSessionSchema = z.object({
  signedUrl: z.string().url(),
  method: z.literal("PUT"),
  storageBucket: z.string(),
  storagePath: z.string(),
});
const MediaAssetIdSchema = z.string().uuid();
const MAX_DOCUMENTS = 6;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

async function uploadCompanyDocument(api: ReturnType<typeof useSession>["api"], userId: string, document: PickedDocument, index: number): Promise<SubmittedDocument> {
  const idempotencyKey = createClientIdempotencyKey(
    "logistics.company.application.document",
    `${document.name.toLowerCase()}:${index}`,
  );
  const uploadSession = await api.post(
    "/runtime/media/upload-sessions",
    {
      contentType: document.mimeType,
      fileName: document.name,
      idempotencyKey,
      storageBucket: "skima-platform-media",
    },
    UploadSessionSchema,
  );
  const file = new File(document.uri);
  const uploaded = await file.createUploadTask(uploadSession.signedUrl, {
    httpMethod: "PUT",
    uploadType: UploadType.BINARY_CONTENT,
    mimeType: document.mimeType,
    headers: { "content-type": document.mimeType },
    sessionType: "background",
  }).uploadAsync();
  if (uploaded.status < 200 || uploaded.status >= 300) {
    throw new Error(`The document upload for ${document.name} was rejected (${uploaded.status}).`);
  }
  const assetId = await api.post(
    "/runtime/media/assets",
    {
      assetTypeKey: "media.generic",
      byteSize: file.size || document.size,
      contentType: document.mimeType,
      idempotencyKey: `${idempotencyKey}:asset`,
      metadata: {
        originalFileName: document.name,
        purpose: "logistics_company_application",
        visibility: "private",
      },
      ownerUserId: userId,
      source: "skima.logistics.mobile",
      storageBucket: uploadSession.storageBucket,
      storagePath: uploadSession.storagePath,
    },
    MediaAssetIdSchema,
  );
  return {
    asset_id: assetId,
    file_name: document.name,
    content_type: document.mimeType,
    byte_size: file.size || document.size,
  };
}

export function CompanyOnboardingScreen() {
  const { palette } = useAppTheme();
  const { api, session } = useSession();
  const [step, setStep] = useState(1);
  const [displayName, setDisplayName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [about, setAbout] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  const [registrationStatus, setRegistrationStatus] = useState<RegistrationStatus>("not_registered");
  const [documents, setDocuments] = useState<PickedDocument[]>([]);
  const [error, setError] = useState<string | null>(null);

  const register = useMutation({
    mutationFn: async () => {
      const userId = session?.user.id;
      if (!userId) throw new Error("Your sign-in session has expired. Sign in again to submit the application.");
      const applicationDocuments = await Promise.all(
        documents.map((document, index) => uploadCompanyDocument(api, userId, document, index)),
      );
      return api.post(
        "/runtime/logistics/company",
        {
          displayName: displayName.trim(),
          legalName: legalName.trim() || null,
          idempotencyKey: createClientIdempotencyKey("logistics.company.register", displayName.trim().toLowerCase()),
          metadata: {
            source: "skima.logistics.mobile",
            onboarding_version: 2,
            registration_status: registrationStatus,
            application_documents: applicationDocuments,
            application_document_visibility: "private_review_only",
          },
        },
        z.string().uuid(),
      );
    },
    onSuccess: async (companyId) => {
      try {
        const companies: Array<Record<string, unknown>> = await api.get("/runtime/logistics/company", z.array(z.record(z.string(), z.unknown())));
        const company = companies.find((item) => item.id === companyId);
        const organizationId = typeof company?.organization_id === "string" ? company.organization_id : null;
        if (organizationId) {
          await api.post("/runtime/logistics/company/profile", {
            organizationId,
            about: about.trim() || null,
            supportContact: {
              email: supportEmail.trim() || null,
              phone: supportPhone.trim() || null,
            },
            metadata: {
              onboarding_contact_configured: true,
              registration_status: registrationStatus,
            },
          }, z.string().uuid());
        }
        router.replace("/provider" as never);
      } catch {
        router.replace("/provider" as never);
      }
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Your company application could not be submitted."),
  });

  const valid = displayName.trim().length >= 2;
  const pickDocuments = async () => {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/jpeg", "image/png"],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const accepted: PickedDocument[] = [];
    for (const asset of result.assets) {
      const mimeType = asset.mimeType ?? "application/octet-stream";
      const size = asset.size ?? 0;
      if (!["application/pdf", "image/jpeg", "image/png"].includes(mimeType)) {
        setError(`${asset.name} was skipped. Upload a PDF, JPG or PNG document.`);
        continue;
      }
      if (size > MAX_DOCUMENT_BYTES) {
        setError(`${asset.name} is larger than 10 MB and was skipped.`);
        continue;
      }
      accepted.push({ uri: asset.uri, name: asset.name, mimeType, size });
    }
    setDocuments((current) => [...current, ...accepted].slice(0, MAX_DOCUMENTS));
  };

  return (
    <Screen eyebrow="PROVIDER REGISTRATION" title="Bring your company to SKIMA" subtitle="A short application now. Company verification and operational setup happen progressively."
      action={<AppButton label="Back" size="sm" variant="secondary" icon={<ArrowLeft color={palette.ink} size={15} />} onPress={() => router.back()} />}>
      <View style={styles.progress}>
        {[1, 2, 3].map((part) => <View key={part} style={[styles.progressSegment, { backgroundColor: part <= step ? palette.brand : palette.border }]} />)}
        <Text style={[styles.progressText, { color: palette.muted }]}>STEP {step} OF 3</Text>
      </View>
      {step === 1 ? (
        <Card padding="lg">
          <View style={styles.intro}>
            <View style={[styles.introIcon, { backgroundColor: palette.brandSoft }]}><Building2 color={palette.brand} size={22} /></View>
            <View style={styles.introCopy}>
              <Text style={[styles.introTitle, { color: palette.ink }]}>A workspace built for your business</Text>
              <Text style={[styles.introBody, { color: palette.muted }]}>Your services, staff, coverage and customer opportunities stay within your company account.</Text>
            </View>
          </View>
          <AppField label="Company display name" value={displayName} onChangeText={setDisplayName} placeholder="e.g. Swift City Logistics" maxLength={160} />
          <AppField label="Registered legal name" value={legalName} onChangeText={setLegalName} placeholder="Legal business name" optional maxLength={200} />
          <AppField label="About your company" value={about} onChangeText={setAbout} placeholder="What do you specialise in? What areas do you cover?" multiline optional maxLength={2000} />
        </Card>
      ) : step === 2 ? (
        <>
          <SectionHeader title="Where should we reach your team?" description="Add at least one contact channel. You can update these details later." />
          <Card padding="lg">
            <View style={styles.intro}>
              <View style={[styles.introIcon, { backgroundColor: palette.successSoft }]}><ShieldCheck color={palette.success} size={21} /></View>
              <View style={styles.introCopy}>
                <Text style={[styles.introTitle, { color: palette.ink }]}>Company contact</Text>
                <Text style={[styles.introBody, { color: palette.muted }]}>These details help SKIMA and customers reach your business. They are not shown as a public directory phone number.</Text>
              </View>
            </View>
            <AppField label="Support phone" value={supportPhone} onChangeText={setSupportPhone} placeholder="+234 800 000 0000" keyboardType="phone-pad" optional />
            <AppField label="Support email" value={supportEmail} onChangeText={setSupportEmail} placeholder="operations@company.com" keyboardType="email-address" autoCapitalize="none" optional />
          </Card>
        </>
      ) : (
        <>
          <SectionHeader title="Registration & supporting documents" description="Share what is available today. Missing formal registration does not prevent you from applying." />
          <Card padding="lg">
            <Text style={[styles.formTitle, { color: palette.ink }]}>What is your company registration status?</Text>
            <View style={styles.statusChoices}>
              {([
                ["registered", "Registered"],
                ["in_progress", "In progress"],
                ["not_registered", "Not registered"],
              ] as const).map(([value, label]) => (
                <AppButton key={value} size="sm" variant={registrationStatus === value ? "primary" : "secondary"} label={label}
                  onPress={() => setRegistrationStatus(value)} />
              ))}
            </View>
            <View style={[styles.noteInline, { backgroundColor: palette.successSoft }]}>
              <CheckCircle2 color={palette.success} size={16} />
              <Text style={[styles.noteText, { color: palette.ink }]}>You can submit without CAC registration. Tell us the current status and SKIMA will review the application and decide whether to approve the company.</Text>
            </View>
            <View style={styles.documentHeader}>
              <View style={styles.documentCopy}>
                <Text style={[styles.formTitle, { color: palette.ink }]}>Company documents</Text>
                <Text style={[styles.introBody, { color: palette.muted }]}>Optional supporting evidence such as registration papers, operating permits, insurance or proof of address.</Text>
              </View>
              <AppButton size="sm" variant="secondary" label="Add files" icon={<Upload color={palette.brand} size={14} />}
                disabled={documents.length >= MAX_DOCUMENTS} onPress={() => void pickDocuments()} />
            </View>
            {documents.length ? (
              <View style={styles.documentList}>
                {documents.map((document, index) => (
                  <View key={document.uri + index} style={[styles.documentRow, { borderColor: palette.border }]}>
                    <FileText color={palette.brand} size={17} />
                    <View style={styles.documentFileCopy}>
                      <Text style={[styles.documentName, { color: palette.ink }]} numberOfLines={1}>{document.name}</Text>
                      <Text style={[styles.introBody, { color: palette.muted }]}>{document.mimeType} · {Math.max(1, Math.round(document.size / 1024))} KB</Text>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${document.name}`}
                      onPress={() => setDocuments((current) => current.filter((_, i) => i !== index))}>
                      <Trash2 color={palette.muted} size={16} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={[styles.emptyDocuments, { color: palette.muted }]}>No documents attached. You can still submit and provide supporting documents during review.</Text>
            )}
            <Text style={[styles.privateHint, { color: palette.muted }]}>Uploaded documents are stored as private review evidence and are not displayed on your public company profile.</Text>
          </Card>
        </>
      )}
      {error ? <View style={[styles.error, { backgroundColor: palette.dangerSoft }]}><Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text></View> : null}
      <View style={[styles.note, { backgroundColor: palette.brandSofter }]}>
        <FileText color={palette.brand} size={16} />
        <Text style={[styles.noteText, { color: palette.ink }]}>Your application can be submitted while registration is pending or unavailable. SKIMA retains the final review and approval decision; only approved, active providers receive and quote on customer requests.</Text>
      </View>
      <View style={styles.actions}>
        {step > 1 ? <AppButton label="Back" variant="secondary" onPress={() => setStep(step - 1)} icon={<ArrowLeft color={palette.ink} size={15} />} /> : null}
        {step < 3 ? (
          <AppButton label="Continue" fullWidth disabled={step === 1 && !valid} onPress={() => setStep(step + 1)} trailingIcon={<ArrowRight color="#FFFFFF" size={16} />} />
        ) : (
          <AppButton label="Submit company application" fullWidth loading={register.isPending} onPress={() => { setError(null); register.mutate(); }} trailingIcon={<ArrowRight color="#FFFFFF" size={16} />} />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: "row", alignItems: "center", gap: 6 },
  progressSegment: { flex: 1, height: 5, borderRadius: radii.pill },
  progressText: { ...typography.eyebrow, fontSize: 8, marginLeft: 5 },
  actions: { flexDirection: "row", gap: spacing.sm },
  intro: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  introIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  introCopy: { flex: 1, gap: 3 },
  introTitle: { ...typography.bodyStrong, fontSize: 13 },
  introBody: { ...typography.caption, fontSize: 10, lineHeight: 16 },
  error: { borderRadius: radii.md, padding: spacing.md },
  errorText: { ...typography.caption, lineHeight: 18 },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: radii.lg, padding: spacing.md },
  noteInline: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: radii.md, padding: spacing.md },
  noteText: { flex: 1, ...typography.caption, fontSize: 10, lineHeight: 17 },
  formTitle: { ...typography.bodyStrong, fontSize: 13 },
  statusChoices: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  documentHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  documentCopy: { flex: 1, gap: 3 },
  documentList: { gap: 8 },
  documentRow: { flexDirection: "row", alignItems: "center", gap: 9, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: 10 },
  documentFileCopy: { flex: 1, minWidth: 0, gap: 2 },
  documentName: { ...typography.bodyStrong, fontSize: 11 },
  emptyDocuments: { ...typography.caption, fontSize: 10, lineHeight: 16 },
  privateHint: { ...typography.caption, fontSize: 9, lineHeight: 14 },
});
