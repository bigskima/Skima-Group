import { AlertCircle, CheckCircle2, ChevronRight, Edit3 } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { PolicySummaryCard } from "../ui/PolicySummaryCard";
import { StatusPill } from "../ui/StatusPill";

export interface SummarySection {
  title: string;
  stepIndex: number;
  items: { label: string; value: string | null | undefined }[];
}

export interface SummaryDocument {
  title: string;
  isRequired: boolean;
  isUploaded: boolean;
  status: string;
  stepIndex: number;
}

export interface ApplicationReviewSummaryProps {
  sections: SummarySection[];
  documents: SummaryDocument[];
  onGoToStep: (stepIndex: number) => void;
  canSubmit: boolean;
  missingItemsCount: number;
}

export function ApplicationReviewSummary({
  sections,
  documents,
  onGoToStep,
  canSubmit,
  missingItemsCount,
}: ApplicationReviewSummaryProps) {
  const { palette } = useAppTheme();
  const requiredDocuments = documents.filter((document) => document.isRequired);
  const completedRequiredDocuments = requiredDocuments.filter((document) => document.isUploaded);
  const optionalDocuments = documents.filter((document) => !document.isRequired);
  const completedOptionalDocuments = optionalDocuments.filter((document) => document.isUploaded);

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.readiness,
          {
            backgroundColor: canSubmit ? palette.successSoft : palette.dangerSoft,
            borderColor: canSubmit ? palette.success : palette.danger,
          },
        ]}
      >
        <View
          style={[
            styles.readinessIcon,
            {
              backgroundColor: canSubmit
                ? "rgba(22,132,71,.10)"
                : "rgba(197,34,31,.10)",
            },
          ]}
        >
          {canSubmit ? (
            <CheckCircle2 color={palette.success} size={22} />
          ) : (
            <AlertCircle color={palette.danger} size={22} />
          )}
        </View>
        <View style={styles.readinessCopy}>
          <Text
            style={[
              styles.readinessTitle,
              { color: canSubmit ? palette.success : palette.danger },
            ]}
          >
            {canSubmit ? "Ready for submission" : "Application incomplete"}
          </Text>
          <Text style={[styles.readinessBody, { color: palette.ink }]}>
            {canSubmit
              ? "All required items are present. Optional evidence can be left blank and will not block submission."
              : `${missingItemsCount} required ${missingItemsCount === 1 ? "item is" : "items are"} still missing. Tap a missing item below to complete it.`}
          </Text>
        </View>
      </View>

      {sections.map((section, index) => (
        <View
          key={`${section.title}-${index}`}
          style={[
            styles.sectionCard,
            shadows.soft,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <View style={[styles.sectionHeader, { borderBottomColor: palette.border }]}>
            <View style={styles.sectionHeaderCopy}>
              <Text style={[styles.sectionEyebrow, { color: palette.brand }]}>REVIEW DETAILS</Text>
              <Text style={[styles.sectionTitle, { color: palette.ink }]}>{section.title}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => onGoToStep(section.stepIndex)}
              style={({ pressed }) => [
                styles.editBtn,
                { backgroundColor: palette.brandSoft, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Edit3 color={palette.brand} size={14} />
              <Text style={[styles.editBtnText, { color: palette.brand }]}>Edit</Text>
            </Pressable>
          </View>

          <View style={styles.sectionBody}>
            {section.items.map((item, itemIndex) => (
              <View
                key={`${item.label}-${itemIndex}`}
                style={[
                  styles.itemRow,
                  itemIndex > 0 && {
                    borderTopColor: palette.border,
                    borderTopWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <Text style={[styles.itemLabel, { color: palette.muted }]}>{item.label}</Text>
                <Text style={[styles.itemValue, { color: palette.ink }]}>{item.value || "—"}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}

      <View
        style={[
          styles.sectionCard,
          shadows.soft,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <View style={[styles.sectionHeader, { borderBottomColor: palette.border }]}>
          <View style={styles.sectionHeaderCopy}>
            <Text style={[styles.sectionEyebrow, { color: palette.brand }]}>EVIDENCE CHECK</Text>
            <Text style={[styles.sectionTitle, { color: palette.ink }]}>Documents & photos</Text>
            {optionalDocuments.length > 0 ? (
              <Text style={[styles.optionalCount, { color: palette.muted }]}>
                {completedOptionalDocuments.length}/{optionalDocuments.length} optional uploaded
              </Text>
            ) : null}
          </View>
          <View
            style={[
              styles.requiredCountBadge,
              { backgroundColor: canSubmit ? palette.successSoft : palette.brandSoft },
            ]}
          >
            <Text
              style={[
                styles.documentCount,
                { color: canSubmit ? palette.success : palette.brand },
              ]}
            >
              {completedRequiredDocuments.length}/{requiredDocuments.length} required
            </Text>
          </View>
        </View>

        <View style={styles.docList}>
          {documents.map((document, documentIndex) => {
            const tone = document.isUploaded
              ? "success"
              : document.isRequired
                ? "danger"
                : "neutral";
            const label = document.isUploaded
              ? document.status || "uploaded"
              : document.isRequired
                ? "missing"
                : "optional";

            return (
              <Pressable
                key={`${document.title}-${documentIndex}`}
                accessibilityRole="button"
                onPress={() => onGoToStep(document.stepIndex)}
                style={({ pressed }) => [
                  styles.docRow,
                  documentIndex > 0 && {
                    borderTopColor: palette.border,
                    borderTopWidth: StyleSheet.hairlineWidth,
                  },
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <View
                  style={[
                    styles.docIconWrap,
                    {
                      backgroundColor: document.isUploaded
                        ? palette.successSoft
                        : document.isRequired
                          ? palette.dangerSoft
                          : palette.soft,
                    },
                  ]}
                >
                  {document.isUploaded ? (
                    <CheckCircle2 color={palette.success} size={18} />
                  ) : document.isRequired ? (
                    <AlertCircle color={palette.danger} size={18} />
                  ) : (
                    <CheckCircle2 color={palette.mutedStrong} size={18} />
                  )}
                </View>

                <View style={styles.docCopy}>
                  <View style={styles.docTitleRow}>
                    <Text style={[styles.docTitle, { color: palette.ink }]}>{document.title}</Text>
                    {!document.isRequired ? (
                      <Text style={[styles.optionalLabel, { color: palette.muted }]}>Optional</Text>
                    ) : null}
                  </View>
                  <StatusPill label={label} tone={tone} />
                </View>

                <ChevronRight color={palette.muted} size={17} />
              </Pressable>
            );
          })}
        </View>
      </View>

      <PolicySummaryCard
        policyKey="policy.partner.participation"
        href="/policies/partner-participation"
        fallbackTitle="SKIMA Partner Participation Terms & Public Policy"
        fallbackSummary="Review the key rules for partner approval, service matching, safety, earnings, privacy, conduct, suspension and your rights before submitting your application."
        bindToCurrentPartnerApplication
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  readiness: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "flex-start",
  },
  readinessIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  readinessCopy: { flex: 1, gap: 3 },
  readinessTitle: { ...typography.subheading, fontSize: 14 },
  readinessBody: { ...typography.caption, lineHeight: 18 },
  sectionCard: {
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.sm,
  },
  sectionHeaderCopy: { flex: 1, gap: 2 },
  sectionEyebrow: { ...typography.eyebrow, fontSize: 9 },
  sectionTitle: { ...typography.subheading, fontSize: 15 },
  optionalCount: { ...typography.caption, fontSize: 10, marginTop: 2 },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radii.pill,
  },
  editBtnText: { ...typography.caption, fontWeight: "900" },
  sectionBody: { paddingTop: 2 },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: 10,
  },
  itemLabel: { ...typography.caption, flex: 0.42 },
  itemValue: {
    ...typography.caption,
    fontWeight: "800",
    flex: 0.58,
    textAlign: "right",
  },
  requiredCountBadge: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  documentCount: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  docList: { paddingTop: 2 },
  docRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    paddingVertical: 11,
  },
  docIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  docCopy: { flex: 1, gap: 6 },
  docTitleRow: { flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  docTitle: { ...typography.caption, fontSize: 13, fontWeight: "800", flexShrink: 1 },
  optionalLabel: { ...typography.caption, fontSize: 9, fontWeight: "800" },
});