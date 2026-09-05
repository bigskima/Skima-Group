import { Eye, ImageIcon, RefreshCw, ShieldCheck, Sparkles } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { z } from "zod";

import { useGatewayMutation, useGatewayQuery } from "../api/gateway";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { StatusPill } from "./StatusPill";

const CylinderVisualReviewSchema = z.object({
  id: z.string().uuid(),
  cylinderId: z.string().uuid(),
  sourceMediaAssetId: z.string().uuid(),
  imageQuality: z.enum(["good", "usable", "poor", "unknown"]),
  visibleColour: z.string().nullable(),
  probableSizeMarkingKg: z.coerce.number().nullable(),
  visibleMarkings: z.array(z.string()).default([]),
  appearanceObservations: z.array(z.string()).default([]),
  retakeSuggestions: z.array(z.string()).default([]),
  manualInspectionRecommended: z.literal(true),
  safetyCertification: z.literal(false),
  mutatesCylinder: z.literal(false),
  createdAt: z.string().nullable().optional(),
});

const CylinderVisualReviewsSchema = z.array(CylinderVisualReviewSchema);

export function CylinderVisualReviewPanel({
  cylinderId,
  sourceMediaAssetId,
}: {
  readonly cylinderId: string;
  readonly sourceMediaAssetId: string | null;
}) {
  const { palette } = useAppTheme();
  const reviews = useGatewayQuery({
    key: ["ai-cylinder-visual-reviews", cylinderId],
    path: `/runtime/ai/cylinder-visual-reviews?cylinderId=${encodeURIComponent(cylinderId)}`,
    schema: CylinderVisualReviewsSchema,
    enabled: Boolean(cylinderId),
    globalError: false,
  });

  const review = reviews.data?.[0] ?? null;
  const visibleMarkings = review?.visibleMarkings ?? [];
  const appearanceObservations = review?.appearanceObservations ?? [];
  const retakeSuggestions = review?.retakeSuggestions ?? [];
  const primaryRetakeSuggestion = retakeSuggestions[0] ?? null;
  const mutation = useGatewayMutation({
    path: "/runtime/ai/cylinder-visual-review",
    schema: CylinderVisualReviewSchema,
    invalidate: [["ai-cylinder-visual-reviews", cylinderId]],
  });

  const runReview = async () => {
    if (!sourceMediaAssetId || mutation.isPending) return;
    await mutation.mutateAsync({
      cylinderId,
      sourceMediaAssetId,
      idempotencyKey: idempotencyKey(
        "cylinder-visual-review",
        `${cylinderId}:${sourceMediaAssetId}:${Date.now()}`,
      ),
    });
  };

  const error = mutation.error
    ? friendlyError(
        mutation.error,
        "The photo could not be reviewed. Your cylinder details were not changed.",
      )
    : null;

  return (
    <View
      style={[
        styles.shell,
        shadows.soft,
        {
          backgroundColor: palette.surface,
          borderColor: palette.border,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}>
          <Eye color={palette.brand} size={19} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: palette.ink }]}>Photo details</Text>
          <Text style={[styles.subtitle, { color: palette.muted }]}>
            AI can describe what is visibly readable in your original cylinder photo.
          </Text>
        </View>
        {review ? (
          <StatusPill
            label={photoQualityLabel(review.imageQuality)}
            tone={photoQualityTone(review.imageQuality)}
          />
        ) : null}
      </View>

      {!sourceMediaAssetId ? (
        <View style={[styles.empty, { backgroundColor: palette.surfaceSubtle }]}>
          <ImageIcon color={palette.mutedStrong} size={18} />
          <Text style={[styles.emptyText, { color: palette.muted }]}>
            An original cylinder photo is needed before SKIMA can review visible details.
          </Text>
        </View>
      ) : review ? (
        <View style={styles.result}>
          <View style={styles.factGrid}>
            <ReviewFact
              label="Visible colour"
              value={review.visibleColour ?? "Not clear enough to confirm"}
            />
            <ReviewFact
              label="Possible printed size"
              value={
                review.probableSizeMarkingKg === null
                  ? "No readable size marking"
                  : `${review.probableSizeMarkingKg} kg · unverified`
              }
            />
          </View>

          {visibleMarkings.length ? (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: palette.muted }]}>VISIBLE MARKINGS</Text>
              <View style={styles.chips}>
                {visibleMarkings.slice(0, 4).map((item) => (
                  <View
                    key={item}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: palette.surfaceSubtle,
                        borderColor: palette.border,
                      },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: palette.ink }]}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {appearanceObservations.length ? (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: palette.muted }]}>VISIBLE APPEARANCE</Text>
              <Text style={[styles.observation, { color: palette.ink }]}>
                {appearanceObservations.slice(0, 3).join(" · ")}
              </Text>
            </View>
          ) : null}

          {primaryRetakeSuggestion ? (
            <View style={[styles.retake, { backgroundColor: palette.surfaceSubtle }]}>
              <RefreshCw color={palette.mutedStrong} size={15} />
              <Text style={[styles.retakeText, { color: palette.mutedStrong }]}>
                {primaryRetakeSuggestion}
              </Text>
            </View>
          ) : null}
        </View>
      ) : reviews.isLoading ? (
        <View style={[styles.empty, { backgroundColor: palette.surfaceSubtle }]}>
          <Sparkles color={palette.brand} size={17} />
          <Text style={[styles.emptyText, { color: palette.muted }]}>
            Checking whether this photo has already been reviewed…
          </Text>
        </View>
      ) : (
        <Text style={[styles.readyText, { color: palette.muted }]}>
          Review is optional and runs only when you press the button below.
        </Text>
      )}

      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>
          {error}
        </Text>
      ) : null}

      {sourceMediaAssetId ? (
        <AppButton
          label={review ? "Review photo again" : "Review photo details"}
          fullWidth
          variant="secondary"
          loading={mutation.isPending}
          icon={<Sparkles color={palette.brand} size={16} />}
          onPress={() => void runReview()}
        />
      ) : null}

      <View style={[styles.guardrail, { backgroundColor: palette.surfaceSubtle }]}>
        <ShieldCheck color={palette.mutedStrong} size={16} />
        <Text style={[styles.guardrailText, { color: palette.muted }]}>
          Photo review is not a safety inspection or certification. It cannot change your registered
          size, condition, refill limit, inspection status, or cylinder identity.
        </Text>
      </View>
    </View>
  );
}

function ReviewFact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.fact}>
      <Text style={[styles.factLabel, { color: palette.muted }]}>{label}</Text>
      <Text style={[styles.factValue, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

function photoQualityLabel(value: "good" | "usable" | "poor" | "unknown"): string {
  if (value === "good") return "Clear photo";
  if (value === "usable") return "Usable photo";
  if (value === "poor") return "Retake helpful";
  return "Photo reviewed";
}

function photoQualityTone(
  value: "good" | "usable" | "poor" | "unknown",
): "success" | "warning" | "neutral" {
  if (value === "good") return "success";
  if (value === "poor") return "warning";
  return "neutral";
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
    padding: spacing.lg,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  icon: {
    alignItems: "center",
    borderRadius: 12,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.bodyStrong,
    fontSize: 14,
  },
  subtitle: {
    ...typography.caption,
    fontSize: 10,
    lineHeight: 15,
  },
  empty: {
    alignItems: "center",
    borderRadius: radii.md,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  emptyText: {
    ...typography.caption,
    flex: 1,
    lineHeight: 16,
  },
  result: {
    gap: spacing.md,
  },
  factGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  fact: {
    flex: 1,
    gap: 2,
  },
  factLabel: {
    ...typography.caption,
    fontSize: 9,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  factValue: {
    ...typography.bodyStrong,
    fontSize: 12,
    lineHeight: 17,
  },
  section: {
    gap: 6,
  },
  sectionLabel: {
    ...typography.caption,
    fontSize: 9,
    fontWeight: "900",
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  chipText: {
    ...typography.caption,
    fontSize: 9,
    fontWeight: "800",
  },
  observation: {
    ...typography.caption,
    fontSize: 10,
    lineHeight: 16,
  },
  retake: {
    alignItems: "flex-start",
    borderRadius: radii.md,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  retakeText: {
    ...typography.caption,
    flex: 1,
    lineHeight: 16,
  },
  readyText: {
    ...typography.caption,
    lineHeight: 16,
  },
  error: {
    ...typography.caption,
    fontWeight: "800",
    lineHeight: 16,
  },
  guardrail: {
    alignItems: "flex-start",
    borderRadius: radii.md,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  guardrailText: {
    ...typography.caption,
    flex: 1,
    fontSize: 9,
    lineHeight: 14,
  },
});
