import { AlertCircle, CheckCircle2, ChevronRight, Edit3 } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing } from "../theme/tokens";

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
  return (
    <View style={styles.container}>
      {/* Readiness Alert */}
      {!canSubmit ? (
        <View style={styles.alertMissing}>
          <AlertCircle color={colors.danger} size={20} />
          <View style={{ flex: 1 }}>
            <Text style={styles.alertMissingTitle}>Incomplete Application</Text>
            <Text style={styles.alertMissingBody}>
              {missingItemsCount} required {missingItemsCount === 1 ? "item is" : "items are"} still missing before you can submit for review.
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.alertReady}>
          <CheckCircle2 color={colors.success} size={20} />
          <View style={{ flex: 1 }}>
            <Text style={styles.alertReadyTitle}>Ready for Submission</Text>
            <Text style={styles.alertReadyBody}>
              All required fields and documents have been completed. Review below before submitting.
            </Text>
          </View>
        </View>
      )}

      {/* Information Sections */}
      {sections.map((section, idx) => (
        <View key={idx} style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Pressable
              onPress={() => onGoToStep(section.stepIndex)}
              style={styles.editBtn}
            >
              <Edit3 color={colors.brand} size={14} />
              <Text style={styles.editBtnText}>Edit</Text>
            </Pressable>
          </View>

          <View style={styles.sectionBody}>
            {section.items.map((item, itemIdx) => (
              <View key={itemIdx} style={styles.itemRow}>
                <Text style={styles.itemLabel}>{item.label}</Text>
                <Text style={styles.itemValue}>{item.value || "—"}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}

      {/* Evidence & Documents Checklist */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Required Evidence & Documents</Text>
        </View>

        <View style={styles.docList}>
          {documents.map((doc, docIdx) => (
            <Pressable
              key={docIdx}
              onPress={() => onGoToStep(doc.stepIndex)}
              style={styles.docRow}
            >
              <View style={styles.docIconWrap}>
                {doc.isUploaded ? (
                  <CheckCircle2 color={colors.success} size={18} />
                ) : doc.isRequired ? (
                  <AlertCircle color={colors.danger} size={18} />
                ) : (
                  <CheckCircle2 color={colors.muted} size={18} />
                )}
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.docTitle}>{doc.title}</Text>
                <Text style={[styles.docStatus, doc.isUploaded ? styles.statusUploaded : styles.statusMissing]}>
                  {doc.isUploaded ? "Uploaded & ready" : doc.isRequired ? "Required — Missing" : "Optional"}
                </Text>
              </View>

              <ChevronRight color={colors.muted} size={16} />
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  alertMissing: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "#FEF2F2",
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: "#FEE2E2",
    alignItems: "flex-start",
  },
  alertMissingTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.danger,
  },
  alertMissingBody: {
    fontSize: 12,
    color: "#7F1D1D",
    lineHeight: 17,
    marginTop: 2,
  },
  alertReady: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "#F0FDF4",
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: "#DCFCE7",
    alignItems: "flex-start",
  },
  alertReadyTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.success,
  },
  alertReadyBody: {
    fontSize: 12,
    color: "#166534",
    lineHeight: 17,
    marginTop: 2,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.xs,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: colors.ink,
  },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  editBtnText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.brand,
  },
  sectionBody: {
    gap: 8,
    paddingTop: 4,
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  itemLabel: {
    fontSize: 13,
    color: colors.muted,
    fontWeight: "600",
  },
  itemValue: {
    fontSize: 13,
    color: colors.ink,
    fontWeight: "800",
  },
  docList: {
    gap: 10,
    paddingTop: 4,
  },
  docRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
  },
  docIconWrap: {
    width: 24,
    alignItems: "center",
  },
  docTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.ink,
  },
  docStatus: {
    fontSize: 11,
    fontWeight: "700",
    marginTop: 1,
  },
  statusUploaded: {
    color: colors.success,
  },
  statusMissing: {
    color: colors.danger,
  },
});
