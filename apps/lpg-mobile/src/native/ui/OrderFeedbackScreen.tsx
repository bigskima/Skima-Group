import { router, useLocalSearchParams } from "expo-router";
import { AlertTriangle, CheckCircle2, Star } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  useCreateLpgComplaint,
  useLpgOrderRatingState,
  useSubmitLpgRating,
} from "../api/quality";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { AppButton } from "./AppButton";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";

const RATING_TAGS = ["Professional", "On time", "Careful handling", "Good communication", "Good service"] as const;

const COMPLAINT_OPTIONS = [
  { label: "Underfilled cylinder", category: "underfill", subjectType: "station", severity: "high" },
  { label: "Unsafe handling or safety concern", category: "safety", subjectType: "order", severity: "critical" },
  { label: "Lost cylinder", category: "lost_cylinder", subjectType: "cylinder", severity: "critical" },
  { label: "Cylinder was switched", category: "switched_cylinder", subjectType: "cylinder", severity: "critical" },
  { label: "Cylinder was damaged", category: "damaged_cylinder", subjectType: "cylinder", severity: "high" },
  { label: "Delivery problem", category: "delivery", subjectType: "driver", severity: "standard" },
  { label: "Payment problem", category: "payment", subjectType: "payment", severity: "high" },
  { label: "Driver or station conduct", category: "conduct", subjectType: "order", severity: "high" },
  { label: "Price problem", category: "pricing", subjectType: "station", severity: "standard" },
  { label: "Something else", category: "other", subjectType: "order", severity: "standard" },
] as const;

type ComplaintOption = (typeof COMPLAINT_OPTIONS)[number];

export function OrderFeedbackScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const orderId = typeof id === "string" ? id : null;
  const { palette } = useAppTheme();
  const state = useLpgOrderRatingState(orderId);

  if (!orderId) {
    return (
      <Screen eyebrow="Service feedback" title="Rate service">
        <EmptyState title="Order unavailable" description="We couldn't identify the order you want to review." action={<AppButton label="Back" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  if (state.isPending) {
    return (
      <Screen eyebrow="Service feedback" title="Rate service" subtitle="Loading the latest completed-service details…">
        <Card><Text style={[styles.body, { color: palette.muted }]}>Checking rating eligibility…</Text></Card>
      </Screen>
    );
  }

  if (state.error) {
    return (
      <Screen eyebrow="Service feedback" title="Rate service">
        <EmptyState title="Feedback unavailable" description={friendlyError(state.error, "We couldn't load feedback options for this order.")} action={<AppButton label="Try again" onPress={() => void state.refetch()} />} />
      </Screen>
    );
  }

  if (!state.data?.eligible) {
    return (
      <Screen eyebrow="Service feedback" title="Rate service">
        <EmptyState title="Available after delivery" description="You can rate the driver and station after the cylinder has been returned and the delivery is completed." action={<AppButton label="Back to order" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  return (
    <Screen
      eyebrow="Completed service"
      title="Rate your experience"
      subtitle="Your latest rating becomes your current rating of that driver or station. Earlier rating events stay securely recorded for service quality and dispute review."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      {state.data.driverProfileId ? (
        <RatingCard
          orderId={orderId}
          subjectType="driver"
          title="Your SKIMA driver"
          existingRating={state.data.driverRating}
        />
      ) : null}

      {state.data.stationBranchId ? (
        <RatingCard
          orderId={orderId}
          subjectType="station"
          title="Refill station"
          existingRating={state.data.stationRating}
        />
      ) : null}

      <ComplaintCard orderId={orderId} />
    </Screen>
  );
}

function RatingCard({
  orderId,
  subjectType,
  title,
  existingRating,
}: {
  readonly orderId: string;
  readonly subjectType: "driver" | "station";
  readonly title: string;
  readonly existingRating: number | null;
}) {
  const { palette } = useAppTheme();
  const submit = useSubmitLpgRating(orderId);
  const [rating, setRating] = useState(existingRating ?? 0);
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState<readonly string[]>([]);
  const [saved, setSaved] = useState(false);

  const toggleTag = (tag: string) => {
    setTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  };

  const save = async () => {
    if (rating < 1 || rating > 5) return;
    await submit.mutateAsync({ subjectType, rating, feedbackTags: tags, comment });
    setSaved(true);
  };

  return (
    <Card padding="lg">
      <View style={styles.titleRow}>
        <View>
          <Text style={[styles.sectionTitle, { color: palette.ink }]}>{title}</Text>
          <Text style={[styles.body, { color: palette.muted }]}>
            {existingRating ? `You previously rated this completed order ${existingRating}/5.` : "Choose 1 to 5 stars."}
          </Text>
        </View>
        {saved ? <CheckCircle2 color={palette.success} size={22} /> : null}
      </View>

      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((value) => (
          <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${value} star${value === 1 ? "" : "s"}`} onPress={() => { setRating(value); setSaved(false); }}>
            <Star color={value <= rating ? palette.brand : palette.borderStrong} fill={value <= rating ? palette.brand : "transparent"} size={34} />
          </Pressable>
        ))}
      </View>

      <View style={styles.tags}>
        {RATING_TAGS.map((tag) => {
          const selected = tags.includes(tag);
          return (
            <Pressable
              key={tag}
              onPress={() => toggleTag(tag)}
              style={[styles.tag, { borderColor: selected ? palette.brand : palette.border, backgroundColor: selected ? palette.brandSoft : palette.surface }]}
            >
              <Text style={[styles.tagText, { color: selected ? palette.brand : palette.mutedStrong }]}>{tag}</Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        value={comment}
        onChangeText={setComment}
        multiline
        maxLength={1000}
        placeholder="Optional comment"
        placeholderTextColor={palette.muted}
        style={[styles.input, { color: palette.ink, borderColor: palette.border, backgroundColor: palette.surfaceSubtle }]}
      />

      {submit.error ? <Text style={[styles.error, { color: palette.danger }]}>{friendlyError(submit.error, "We couldn't save this rating.")}</Text> : null}
      <AppButton label={existingRating ? "Update rating" : "Save rating"} fullWidth disabled={rating < 1} loading={submit.isPending} onPress={() => void save()} />
    </Card>
  );
}

function ComplaintCard({ orderId }: { readonly orderId: string }) {
  const { palette } = useAppTheme();
  const create = useCreateLpgComplaint(orderId);
  const [selected, setSelected] = useState<ComplaintOption | null>(null);
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const helper = useMemo(() => selected?.category === "underfill"
    ? "A quantity complaint is reviewed as a service issue, not treated as proof from the star rating alone."
    : "Tell us what happened. Serious safety, custody, fraud and payment reports are handled separately from ratings.", [selected]);

  const submit = async () => {
    if (!selected || description.trim().length < 10) return;
    await create.mutateAsync({
      subjectType: selected.subjectType,
      category: selected.category,
      severity: selected.severity,
      description,
    });
    setSubmitted(true);
  };

  return (
    <View style={[styles.complaintCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.titleRow}>
        <View style={styles.titleCopy}>
          <Text style={[styles.sectionTitle, { color: palette.ink }]}>Report a problem</Text>
          <Text style={[styles.body, { color: palette.muted }]}>{helper}</Text>
        </View>
        <AlertTriangle color={palette.brand} size={22} />
      </View>

      <View style={styles.optionList}>
        {COMPLAINT_OPTIONS.map((option) => {
          const active = selected?.category === option.category && selected?.label === option.label;
          return (
            <Pressable
              key={option.label}
              onPress={() => { setSelected(option); setSubmitted(false); }}
              style={[styles.option, { borderColor: active ? palette.brand : palette.border, backgroundColor: active ? palette.brandSoft : palette.surface }]}
            >
              <Text style={[styles.optionText, { color: active ? palette.brand : palette.ink }]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {selected ? (
        <>
          <TextInput
            value={description}
            onChangeText={(value) => { setDescription(value); setSubmitted(false); }}
            multiline
            maxLength={4000}
            placeholder="Describe what happened"
            placeholderTextColor={palette.muted}
            style={[styles.complaintInput, { color: palette.ink, borderColor: palette.border, backgroundColor: palette.surfaceSubtle }]}
          />
          {create.error ? <Text style={[styles.error, { color: palette.danger }]}>{friendlyError(create.error, "We couldn't submit this report.")}</Text> : null}
          {submitted ? <Text style={[styles.success, { color: palette.success }]}>Your report has been received.</Text> : null}
          <AppButton label="Submit report" fullWidth disabled={description.trim().length < 10} loading={create.isPending} onPress={() => void submit()} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.sm },
  titleCopy: { flex: 1, gap: 4 },
  sectionTitle: { ...typography.subheading, fontSize: 16 },
  body: { ...typography.body, fontSize: 13, lineHeight: 20 },
  stars: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.md },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: spacing.md },
  tag: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  tagText: { ...typography.caption, fontWeight: "800" },
  input: { minHeight: 88, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md, textAlignVertical: "top", marginBottom: spacing.md },
  complaintCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md },
  optionList: { gap: 8 },
  option: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md },
  optionText: { ...typography.bodyStrong, fontSize: 13 },
  complaintInput: { minHeight: 110, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md, textAlignVertical: "top" },
  error: { ...typography.caption, fontWeight: "700" },
  success: { ...typography.bodyStrong, fontSize: 13 },
});
