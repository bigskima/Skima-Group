import { router } from "expo-router";
import { BarChart3, BriefcaseBusiness, Gauge, ShieldCheck } from "lucide-react-native";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { domainQueries, useStationRuntime } from "../api/domains";
import {
  displayReference,
  displayStatus,
  firstNumber,
  firstString,
  nestedRecords,
  recordId,
} from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { RequestFailureState } from "./RequestFailureState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { SectionHeader } from "./SectionHeader";

export function StationReportsScreen() {
  const { palette } = useAppTheme();
  const runtime = useStationRuntime();
  const settlements = domainQueries.settlements();
  const orders = nestedRecords(runtime.data, "orders");
  const completed = orders.filter((item) =>
    ["completed", "station_settled", "delivered"].some((state) =>
      (displayStatus(item) ?? "").includes(state),
    ),
  );
  const active = orders.filter((item) => !completed.includes(item));
  const totalKg = completed.reduce(
    (sum, item) => sum + (firstNumber(item, ["actualKg", "actual_kg", "refillKg"]) ?? 0),
    0,
  );

  if (runtime.isPending) {
    return (
      <Screen eyebrow="Station activity" title="Reports" action={<BackButton />}>
        <ScreenSkeleton cards={3} />
      </Screen>
    );
  }

  if (runtime.error) {
    return (
      <Screen
        eyebrow="Station activity"
        title="Reports"
        subtitle="See completed orders and station earnings."
        action={<BackButton />}
      >
        <EmptyState
          icon={<BarChart3 color={palette.brand} size={27} />}
          title="Station activity could not be loaded"
          description={friendlyError(
            runtime.error,
            "We couldn't load this station's operational activity. Please refresh and try again.",
          )}
          action={<AppButton label="Retry" onPress={() => void runtime.refetch()} />}
        />
      </Screen>
    );
  }

  return (
    <Screen
      eyebrow="Station activity"
      title="Reports"
      subtitle="Operational activity stays visible even when settlement access is restricted."
      action={<BackButton />}
    >
      <View style={styles.metricGrid}>
        <Metric
          icon={<BriefcaseBusiness color={palette.brand} size={19} />}
          label="Active jobs"
          value={String(active.length)}
        />
        <Metric
          icon={<ShieldCheck color={palette.success} size={19} />}
          label="Completed"
          value={String(completed.length)}
        />
        <Metric
          icon={<Gauge color={palette.brand} size={19} />}
          label="Verified kg"
          value={totalKg.toFixed(1)}
        />
      </View>

      <SectionHeader
        title="Settlement summary"
        description="Financial information is shown only to Station Owners and operators who have settlement or finance access."
      />
      <SettlementSummary
        data={settlements.data ?? []}
        error={settlements.error}
        loading={settlements.isPending}
        onRetry={() => void settlements.refetch()}
      />

      <SectionHeader
        title="Recent completed orders"
        description="The latest LPG orders completed by this station."
      />
      <View style={styles.operationList}>
        {completed.length ? (
          completed.slice(0, 10).map((item, index) => (
            <View
              key={recordId(item) ?? String(index)}
              style={[
                styles.operationCard,
                shadows.soft,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}
            >
              <View style={[styles.operationIcon, { backgroundColor: palette.brandSoft }]}>
                <BriefcaseBusiness color={palette.brand} size={20} />
              </View>
              <View style={styles.operationCopy}>
                <Text numberOfLines={1} style={[styles.operationTitle, { color: palette.ink }]}>
                  {displayReference(item) ?? "Completed LPG operation"}
                </Text>
                <Text style={[styles.operationMeta, { color: palette.muted }]}>
                  {friendly(displayStatus(item) ?? "completed")}
                </Text>
              </View>
              <Text style={[styles.operationKg, { color: palette.ink }]}>
                {firstNumber(item, ["actualKg", "actual_kg", "refillKg"]) ?? "—"} kg
              </Text>
            </View>
          ))
        ) : (
          <EmptyState
            icon={<BarChart3 color={palette.brand} size={27} />}
            title="No completed operations yet"
            description="Completed LPG orders will appear here."
          />
        )}
      </View>
    </Screen>
  );
}

function SettlementSummary({
  data,
  error,
  loading,
  onRetry,
}: {
  data: readonly Record<string, unknown>[];
  error: unknown;
  loading: boolean;
  onRetry: () => void;
}) {
  const { palette } = useAppTheme();

  if (loading) {
    return (
      <View style={[styles.settlementState, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ActivityIndicator color={palette.brand} />
        <View style={styles.settlementCopy}>
          <Text style={[styles.settlementTitle, { color: palette.ink }]}>Loading settlement information</Text>
          <Text style={[styles.settlementBody, { color: palette.muted }]}>Checking the latest station earnings and settlement records.</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <RequestFailureState
        error={error}
        onRetry={onRetry}
        overrides={{
          permission: {
            title: "Settlement access is restricted",
            description: "You do not have permission to view settlement information for this station. Access is limited to the Station Owner and operators explicitly granted finance or settlement access.",
          },
          role: {
            title: "Your Station role cannot view settlements",
            description: "This role can continue station operations, but settlement information requires an authorized financial role.",
          },
          station_scope: {
            title: "Settlement information belongs to another Station",
            description: "Your current Station access does not include these settlement records. Switch to the correct Station or ask the Station Owner to review your access.",
          },
          missing: {
            title: "Settlement information is not available yet",
            description: "No settlement record is available for this Station at the moment.",
          },
          network: {
            title: "Settlement information could not connect",
            description: "Check your internet connection and retry. Your Station operations are still available.",
          },
          service_unavailable: {
            title: "Settlement service is temporarily unavailable",
            description: "The settlement service is not available right now. Retry shortly; this does not affect current Station jobs.",
          },
          server: {
            title: "Settlement information could not be refreshed",
            description: "SKIMA could not refresh settlement information right now. Retry without leaving the Station workspace.",
          },
        }}
      />
    );
  }

  if (!data.length) {
    return (
      <View style={[styles.settlementState, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <BarChart3 color={palette.brand} size={22} />
        <View style={styles.settlementCopy}>
          <Text style={[styles.settlementTitle, { color: palette.ink }]}>No settlement activity yet</Text>
          <Text style={[styles.settlementBody, { color: palette.muted }]}>Station earnings will appear after an eligible refill reaches settlement.</Text>
        </View>
      </View>
    );
  }

  const net = data.reduce(
    (sum, item) => sum + (firstNumber(item, ["net_amount", "netAmount"]) ?? 0),
    0,
  );
  const currency = firstString(data[0], ["currency_code", "currencyCode"]) ?? "NGN";

  return (
    <View style={[styles.reportHero, shadows.raised, { backgroundColor: palette.brand }]}>
      <BarChart3 color="#FFFFFF" size={27} />
      <View style={styles.reportCopy}>
        <Text style={styles.reportEyebrow}>TOTAL SETTLED EARNINGS</Text>
        <Text adjustsFontSizeToFit numberOfLines={1} style={styles.reportValue}>
          {money(net, currency)}
        </Text>
      </View>
    </View>
  );
}

function BackButton() {
  return <AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.metric, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={[styles.metricIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View>
      <Text numberOfLines={1} style={[styles.metricValue, { color: palette.ink }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: palette.muted }]}>{label}</Text>
    </View>
  );
}

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function friendly(value: string) {
  return value.replace(/[_-]/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

const styles = StyleSheet.create({
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metric: {
    flexGrow: 1,
    flexBasis: 100,
    minWidth: 96,
    gap: spacing.xs,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
  },
  metricIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  metricValue: { ...typography.heading, fontSize: 18 },
  metricLabel: { ...typography.caption },
  settlementState: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
  },
  settlementCopy: { flex: 1, gap: spacing.xs },
  settlementTitle: { ...typography.bodyStrong, fontSize: 15 },
  settlementBody: { ...typography.caption, lineHeight: 18 },
  reportHero: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  reportCopy: { flex: 1, minWidth: 0 },
  reportEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 9 },
  reportValue: { color: "#FFFFFF", ...typography.heading, fontSize: 24, marginTop: 2 },
  operationList: { gap: spacing.sm },
  operationCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg },
  operationIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  operationCopy: { flex: 1, minWidth: 0 },
  operationTitle: { ...typography.bodyStrong, fontSize: 14 },
  operationMeta: { ...typography.caption, marginTop: 2 },
  operationKg: { ...typography.bodyStrong, fontSize: 13 },
});