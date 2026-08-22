import { router } from "expo-router";
import { BookOpen, CheckCircle2, ChevronRight } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { domainQueries } from "../api/domains";
import { useCurrentPolicy, useCurrentPolicyAcceptance } from "../api/policies";
import { firstString, recordId } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";

const EDITABLE_PARTNER_APPLICATION_STATUSES = new Set([
  "draft",
  "incomplete",
  "additional_info_required",
  "resubmitted",
]);

export function PolicySummaryCard({
  policyKey,
  href,
  fallbackTitle,
  fallbackSummary,
  bindToCurrentPartnerApplication = false,
}: {
  readonly policyKey: "policy.customer.terms" | "policy.partner.participation";
  readonly href: "/policies/customer-terms" | "/policies/partner-participation";
  readonly fallbackTitle: string;
  readonly fallbackSummary: string;
  readonly bindToCurrentPartnerApplication?: boolean;
}) {
  const { palette } = useAppTheme();
  const policy = useCurrentPolicy(policyKey);
  const applications = domainQueries.applications();
  const applicationTypes = domainQueries.applicationTypes();

  const applicationContext = useMemo(() => {
    if (!bindToCurrentPartnerApplication || policyKey !== "policy.partner.participation") {
      return null;
    }

    const typeById = new Map(
      (applicationTypes.data ?? []).flatMap((type) => {
        const id = recordId(type);
        return id ? [[id, type] as const] : [];
      }),
    );

    return (applications.data ?? [])
      .flatMap((application) => {
        const id = recordId(application);
        const typeId = firstString(application, ["application_type_id", "applicationTypeId"]);
        const type = typeId ? typeById.get(typeId) : null;
        const category = firstString(type, ["application_category", "applicationCategory"]);
        const status = firstString(application, ["status"]) ?? "";
        if (!id || !category || !["driver", "business"].includes(category)) return [];
        if (!EDITABLE_PARTNER_APPLICATION_STATUSES.has(status)) return [];

        const updatedAt =
          firstString(application, ["updated_at", "updatedAt", "created_at", "createdAt"]) ?? "";

        return [{
          applicationId: id,
          roleKey: category === "driver" ? "skima.driver_partner" : "skima.station_partner",
          updatedAt,
        }];
      })
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? null;
  }, [applications.data, applicationTypes.data, bindToCurrentPartnerApplication, policyKey]);

  const acceptance = useCurrentPolicyAcceptance(
    policyKey,
    applicationContext?.applicationId ?? null,
    Boolean(policy.data?.published),
  );

  const title = policy.data?.title ?? fallbackTitle;
  const summary = policy.data?.summary?.trim() || fallbackSummary;
  const showApplicationAcceptance = Boolean(
    bindToCurrentPartnerApplication &&
    policyKey === "policy.partner.participation" &&
    applicationContext?.applicationId &&
    policy.data?.published,
  );
  const accepted = showApplicationAcceptance && acceptance.data === true;

  const openPolicy = () => {
    if (applicationContext?.applicationId) {
      router.push({
        pathname: href,
        params: {
          applicationId: applicationContext.applicationId,
          roleKey: applicationContext.roleKey,
        },
      } as never);
      return;
    }
    router.push(href as never);
  };

  return (
    <View
      style={[
        styles.card,
        shadows.soft,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <View style={[styles.iconBox, { backgroundColor: palette.brandSoft }]}>
        <BookOpen color={palette.brand} size={20} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.eyebrow, { color: palette.brand }]}>TERMS & POLICY</Text>
        <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
        <Text style={[styles.summary, { color: palette.muted }]}>{summary}</Text>

        {showApplicationAcceptance ? (
          <View
            style={[
              styles.acceptanceRow,
              { backgroundColor: accepted ? palette.successSoft : palette.brandSoft },
            ]}
          >
            {accepted ? <CheckCircle2 color={palette.success} size={15} /> : null}
            <Text
              style={[
                styles.acceptanceText,
                { color: accepted ? palette.success : palette.brand },
              ]}
            >
              {accepted
                ? "Accepted for this application"
                : "Review and accept before submitting this application"}
            </Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={openPolicy}
          style={({ pressed }) => [styles.learnMore, { opacity: pressed ? 0.65 : 1 }]}
        >
          <Text style={[styles.learnMoreText, { color: palette.brand }]}>Learn more</Text>
          <ChevronRight color={palette.brand} size={16} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  eyebrow: { ...typography.eyebrow, fontSize: 9 },
  title: { ...typography.subheading, fontSize: 14 },
  summary: { ...typography.caption, lineHeight: 18 },
  acceptanceRow: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 6,
    marginTop: 4,
  },
  acceptanceText: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  learnMore: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginTop: 4,
    paddingVertical: 4,
  },
  learnMoreText: { ...typography.caption, fontWeight: "900" },
});