import { router, useLocalSearchParams } from "expo-router";
import { AlertTriangle, CheckCircle2, Star } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  type ComplaintCategory,
  type ComplaintSubject,
  type RatingSubject,
  useCreateLpgComplaint,
  useOrderRatingState,
  useSubmitLpgRating,
} from "../api/ratings";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { AppButton } from "./AppButton";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";

const DRIVER_TAGS = ["Professional", "Careful handling", "On time", "Clear updates", "Friendly"] as const;
const STATION_TAGS = ["Accurate refill", "Ready on time", "Good service", "Transparent price", "Safe handling"] as const;

const COMPLAINT_OPTIONS: readonly {
  category: ComplaintCategory;
  subject: ComplaintSubject;
  label: string;
  description: string;
  severity: "standard" | "high" | "critical";
}[] = [
  { category: "underfill", subject: "station", label: "Possible underfill", description: "The LPG quantity supplied appears lower than what the order shows.", severity: "high" },
  { category: "safety", subject: "order", label: "Safety concern", description: "Report unsafe handling, a leak, dangerous conduct or another immediate service safety concern.", severity: "critical" },
  { category: "lost_cylinder", subject: "cylinder", label: "Cylinder missing", description: "Your cylinder has not been returned or cannot be accounted for.", severity: "critical" },
  { category: "switched_cylinder", subject: "cylinder", label: "Wrong cylinder returned", description: "The cylinder returned appears to be different from the one collected.", severity: "critical" },
  { category: "damaged_cylinder", subject: "cylinder", label: "Cylinder damaged", description: "Your cylinder appears to have been damaged during the service journey.", severity: "high" },
  { category: "delivery", subject: "driver", label: "Delivery problem", description: "There was a problem with pickup, return delivery or driver conduct during delivery.", severity: "standard" },
  { category: "payment", subject: "payment", label: "Payment or refund problem", description: "The amount charged, refund or payment status appears incorrect.", severity: "standard" },
  { category: "pricing", subject: "station", label: "Pricing concern", description: "The station price or an order price change does not match what you were shown.", severity: "standard" },
  { category: "fraud", subject: "order", label: "Suspected fraud", description: "Report a suspicious payment, identity, completion or service record.", severity: "critical" },
  { category: "other", subject: "order", label: "Something else", description: "Report another serious issue with this refill order.", severity: "standard" },
];

export function OrderRatingScreen({ subject }: { readonly subject: RatingSubject }) {
  const { palette } = useAppTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const orderId = id ?? "";
  const state = useOrderRatingState(orderId || null);
  const submit = useSubmitLpgRating(orderId, subject);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const existing = subject === "driver" ? state.data?.driverRating : state.data?.stationRating;
  const targetExists = subject === "driver" ? Boolean(state.data?.driverProfileId) : Boolean(state.data?.stationBranchId);
  const tagOptions = subject === "driver" ? DRIVER_TAGS : STATION_TAGS;
  const title = subject === "driver" ? "Rate your driver" : "Rate the station";

  const toggleTag = (tag: string) => {
    setTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  };

  const send = async () => {
    await submit.mutateAsync({ rating, feedbackTags: tags, comment });
  };

  return (
    <Screen
      eyebrow="Service feedback"
      title={title}
      subtitle={subject === "driver"
        ? "Your feedback helps SKIMA improve driver service quality without overriding safety or eligibility rules."
        : "Rate the refill service you received from the station."}
      action={<AppButton label="Back" size="sm" variant="ghost" onPress={() => router.back()} />}
    >
      {state.isLoading ? <Card><Text style={[styles.body, { color: palette.muted }]}>Loading rating options…</Text></Card> : null}
      {state.error ? <EmptyState title="Rating unavailable" description={friendlyError(state.error, "We couldn't load this order's rating status.")} action={<AppButton label="Try again" variant="secondary" onPress={() => void state.refetch()} />} /> : null}

      {state.data && (!state.data.eligible || !targetExists) ? (
        <EmptyState title="Rating not available yet" description="Ratings become available after the completed service has a verified driver or station relationship." />
      ) : null}

      {state.data?.eligible && targetExists && existing ? (
        <Card>
          <View style={styles.successRow}>
            <CheckCircle2 color={palette.success} size={24} />
            <View style={styles.flex}>
              <Text style={[styles.sectionTitle, { color: palette.ink }]}>Feedback already recorded</Text>
              <Text style={[styles.body, { color: palette.muted }]}>You gave this {subject} {existing} star{existing === 1 ? "" : "s"} for this order.</Text>
            </View>
          </View>
          <Text style={[styles.note, { color: palette.muted }]}>If the same {subject} serves you again, the later completed order can update your current relationship rating. SKIMA still preserves the earlier rating event for audit, fraud prevention and dispute review.</Text>
        </Card>
      ) : null}

      {state.data?.eligible && targetExists && !existing ? (
        <>
          <Card>
            <Text style={[styles.sectionTitle, { color: palette.ink }]}>How was this service?</Text>
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((value) => (
                <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${value} star rating`} onPress={() => setRating(value)} style={styles.starButton}>
                  <Star size={34} color={value <= rating ? palette.brand : palette.borderStrong} fill={value <= rating ? palette.brand : "transparent"} />
                </Pressable>
              ))}
            </View>
            <Text style={[styles.ratingHint, { color: palette.muted }]}>{rating ? ratingLabel(rating) : "Choose 1 to 5 stars"}</Text>
          </Card>

          <Card>
            <Text style={[styles.sectionTitle, { color: palette.ink }]}>What stood out?</Text>
            <View style={styles.tags}>
              {tagOptions.map((tag) => {
                const selected = tags.includes(tag);
                return (
                  <Pressable key={tag} onPress={() => toggleTag(tag)} style={[styles.tag, { borderColor: selected ? palette.brand : palette.border, backgroundColor: selected ? palette.brandSoft : palette.surface }]}>
                    <Text style={[styles.tagText, { color: selected ? palette.brand : palette.mutedStrong }]}>{tag}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              accessibilityLabel="Optional rating comment"
              multiline
              maxLength={1000}
              placeholder="Add an optional comment"
              placeholderTextColor={palette.muted}
              value={comment}
              onChangeText={setComment}
              style={[styles.input, { borderColor: palette.border, color: palette.ink, backgroundColor: palette.surfaceSubtle }]}
            />
            {submit.error ? <Text style={[styles.error, { color: palette.danger }]}>{friendlyError(submit.error, "We couldn't save your rating. Please try again.")}</Text> : null}
            <AppButton label="Submit rating" fullWidth disabled={rating < 1} loading={submit.isPending} onPress={() => void send()} />
          </Card>

          <View style={[styles.infoBox, { borderColor: palette.border, backgroundColor: palette.surfaceSubtle }]}>
            <Text style={[styles.note, { color: palette.mutedStrong }]}>A star rating is for service quality. For underfill, safety, a missing/switched cylinder, payment fraud or another serious issue, use the separate report option so SKIMA can investigate evidence properly.</Text>
          </View>
        </>
      ) : null}
    </Screen>
  );
}

export function OrderComplaintScreen() {
  const { palette } = useAppTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const orderId = id ?? "";
  const complaint = useCreateLpgComplaint(orderId);
  const [selectedCategory, setSelectedCategory] = useState<ComplaintCategory | null>(null);
  const [description, setDescription] = useState("");
  const selected = useMemo(() => COMPLAINT_OPTIONS.find((item) => item.category === selectedCategory) ?? null, [selectedCategory]);

  const submit = async () => {
    if (!selected) return;
    await complaint.mutateAsync({ subject: selected.subject, category: selected.category, description, severity: selected.severity });
  };

  if (complaint.isSuccess) {
    return (
      <Screen eyebrow="Order support" title="Report received" subtitle="SKIMA has created a traceable service complaint for this order." action={<AppButton label="Back to order" size="sm" variant="ghost" onPress={() => router.back()} />}>
        <Card>
          <View style={styles.successRow}>
            <CheckCircle2 color={palette.success} size={26} />
            <View style={styles.flex}>
              <Text style={[styles.sectionTitle, { color: palette.ink }]}>Your report has been recorded</Text>
              <Text style={[styles.body, { color: palette.muted }]}>Support can review the order, custody, refill, payment and service evidence that applies to this issue.</Text>
            </View>
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen eyebrow="Order support" title="Report a serious issue" subtitle="Use this for issues that need investigation rather than only a star rating." action={<AppButton label="Back" size="sm" variant="ghost" onPress={() => router.back()} />}>
      <View style={[styles.warning, shadows.soft, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
        <AlertTriangle color={palette.danger} size={22} />
        <Text style={[styles.warningText, { color: palette.ink }]}>For an immediate gas leak, fire, serious injury or other emergency, prioritize personal safety and contact the appropriate emergency or local safety authority. This report form is not emergency assistance.</Text>
      </View>

      <Card>
        <Text style={[styles.sectionTitle, { color: palette.ink }]}>What happened?</Text>
        <View style={styles.optionList}>
          {COMPLAINT_OPTIONS.map((option) => {
            const selectedOption = option.category === selectedCategory;
            return (
              <Pressable key={option.category} onPress={() => setSelectedCategory(option.category)} style={[styles.option, { borderColor: selectedOption ? palette.brand : palette.border, backgroundColor: selectedOption ? palette.brandSoft : palette.surface }]}>
                <View style={styles.flex}>
                  <Text style={[styles.optionTitle, { color: palette.ink }]}>{option.label}</Text>
                  <Text style={[styles.optionBody, { color: palette.muted }]}>{option.description}</Text>
                </View>
                <View style={[styles.radio, { borderColor: selectedOption ? palette.brand : palette.borderStrong }]}>{selectedOption ? <View style={[styles.radioDot, { backgroundColor: palette.brand }]} /> : null}</View>
              </Pressable>
            );
          })}
        </View>
      </Card>

      {selected ? (
        <Card>
          <Text style={[styles.sectionTitle, { color: palette.ink }]}>Describe the issue</Text>
          <Text style={[styles.body, { color: palette.muted }]}>Give enough detail for SKIMA to understand what happened. Do not include passwords, OTP codes or unnecessary sensitive identity information.</Text>
          <TextInput
            multiline
            maxLength={4000}
            placeholder="Describe what happened, when you noticed it and what you need help with."
            placeholderTextColor={palette.muted}
            value={description}
            onChangeText={setDescription}
            style={[styles.input, styles.complaintInput, { borderColor: palette.border, color: palette.ink, backgroundColor: palette.surfaceSubtle }]}
          />
          <Text style={[styles.counter, { color: palette.muted }]}>{description.trim().length}/4000</Text>
          {complaint.error ? <Text style={[styles.error, { color: palette.danger }]}>{friendlyError(complaint.error, "We couldn't submit your report. Please try again.")}</Text> : null}
          <AppButton label="Submit report" fullWidth disabled={description.trim().length < 10} loading={complaint.isPending} onPress={() => void submit()} />
        </Card>
      ) : null}
    </Screen>
  );
}

function ratingLabel(value: number) {
  return ({ 1: "Very poor", 2: "Poor", 3: "Okay", 4: "Good", 5: "Excellent" } as Record<number, string>)[value] ?? "";
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  body: { ...typography.body, fontSize: 14, lineHeight: 21 },
  sectionTitle: { ...typography.subheading, fontSize: 16 },
  stars: { flexDirection: "row", justifyContent: "space-between", gap: spacing.xs, marginTop: spacing.md },
  starButton: { padding: 4 },
  ratingHint: { ...typography.caption, textAlign: "center", marginTop: spacing.xs },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginVertical: spacing.md },
  tag: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  tagText: { ...typography.caption, fontWeight: "800" },
  input: { minHeight: 96, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md, textAlignVertical: "top", ...typography.body, marginVertical: spacing.md },
  complaintInput: { minHeight: 150, marginBottom: spacing.xs },
  error: { ...typography.caption, fontWeight: "700", marginBottom: spacing.sm },
  successRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  note: { ...typography.caption, lineHeight: 18 },
  infoBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md },
  warning: { flexDirection: "row", gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md, alignItems: "flex-start" },
  warningText: { flex: 1, ...typography.caption, lineHeight: 19 },
  optionList: { gap: spacing.sm, marginTop: spacing.md },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md },
  optionTitle: { ...typography.bodyStrong, fontSize: 14 },
  optionBody: { ...typography.caption, lineHeight: 18, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  counter: { ...typography.caption, textAlign: "right", marginBottom: spacing.sm },
});
