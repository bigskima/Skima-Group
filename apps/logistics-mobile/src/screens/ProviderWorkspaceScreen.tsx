import { router } from "expo-router";
import { BriefcaseBusiness, Building2, ChevronRight, Settings2, Truck, UsersRound, WalletCards } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { ReactNode } from "react";
import { asString, useLogisticsRecordQuery, useLogisticsQuery } from "../api/logistics";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { StatusPill } from "../ui/StatusPill";
import { GuideLaunchLink, GuideTarget } from "../onboarding/LogisticsGuideProvider";

export function ProviderWorkspaceScreen() {
  const { palette } = useAppTheme();
  const { width } = useWindowDimensions();
  const companies = useLogisticsQuery(["workspace-company"], "/runtime/logistics/company", true, 45_000);
  const driverProfile = useLogisticsRecordQuery(["workspace-driver-profile"], "/runtime/logistics/driver/profile", true);
  const company = companies.data?.[0] ?? null;
  const desktop = width >= 720;

  return (
    <Screen
      title="Company workspace"
      denseHeader
    >
      <GuideLaunchLink workspace="company"/>
      {companies.isPending ? <ScreenSkeleton cards={2} /> : companies.error ? (
        <Card variant="warning" padding="lg">
          <Text style={[styles.title, { color: palette.ink }]}>Workspace unavailable</Text>
          <Text style={[styles.body, { color: palette.muted }]}>Refresh the company record to load your workspace tools.</Text>
        </Card>
      ) : (
        <>
          {company ? (
            <Card variant="brandSoft" padding="lg" style={styles.companyCard}>
              <View style={styles.companyHead}>
                <View style={[styles.companyIcon, { backgroundColor: palette.surface }]}><Building2 color={palette.brand} size={22} /></View>
                <View style={styles.companyCopy}>
                  <Text style={[styles.eyebrow, { color: palette.brand }]}>YOUR ORGANISATION</Text>
                  <Text style={[styles.companyName, { color: palette.ink }]} numberOfLines={2}>
                    {asString(company, "public_name", "organization_name") ?? "Logistics company"}
                  </Text>
                  <Text style={[styles.body, { color: palette.muted }]}>
                    {asString(company, "verification_status") === "verified" ? "Verified provider" : "Verification in progress"}
                  </Text>
                </View>
                <StatusPill status={asString(company, "operational_status") ?? "onboarding"} />
              </View>
            </Card>
          ) : (
            <Card padding="lg" style={styles.companyCard}>
              <View style={styles.companyHead}>
                <View style={[styles.companyIcon, { backgroundColor: palette.brandSoft }]}><Building2 color={palette.brand} size={22} /></View>
                <View style={styles.companyCopy}>
                  <Text style={[styles.title, { color: palette.ink }]}>Start with your company profile</Text>
                  <Text style={[styles.body, { color: palette.muted }]}>Register your organisation, then add the services and areas your team can cover.</Text>
                </View>
              </View>
            </Card>
          )}

          <GuideTarget targetKey="company-workspace-finance" style={styles.grid}>
          <View style={styles.grid}>
            <WorkspaceCard title="Company wallet & payouts" description="View settled earnings, withdraw and set driver payment method." icon={<WalletCards color={palette.brand} size={21} />} onPress={() => router.push("/(provider)/finance" as never)} desktop={desktop} disabled={!company} />
            <WorkspaceCard
              title="Customer opportunities"
              description="Review matched customer requests and prepare offers for routes your company serves."
              icon={<BriefcaseBusiness color={palette.brand} size={21} />}
              onPress={() => router.push("/(provider)/opportunities" as never)}
              desktop={desktop}
              disabled={!company}
            />
            <WorkspaceCard
              title="Services & coverage"
              description="Set up what your company offers, pricing approach and operating areas."
              icon={<Truck color={palette.brand} size={21} />}
              onPress={() => router.push("/(provider)/services" as never)}
              desktop={desktop}
            />
            <WorkspaceCard
              title="Team & access"
              description="Invite staff and assign the right operational responsibilities."
              icon={<UsersRound color={palette.brand} size={21} />}
              onPress={() => router.push("/(provider)/team" as never)}
              desktop={desktop}
              disabled={!company}
            />
            {driverProfile.data?.registered === true ? (
              <WorkspaceCard
                title="Driver workspace"
                description="Open the focused mobile delivery workflow for your approved driver profile."
                icon={<Truck color={palette.brand} size={21} />}
                onPress={() => router.push("/(provider)/driver" as never)}
                desktop={desktop}
              />
            ) : null}
            <WorkspaceCard
              title="Account & security"
              description="Manage company sign-in, profile and security settings."
              icon={<Settings2 color={palette.brand} size={21} />}
              onPress={() => router.push("/(provider)/account" as never)}
              desktop={desktop}
            />
          </View>
          </GuideTarget>
          <GuideTarget targetKey="company-workspace-services">
            <View style={{height:1}} />
          </GuideTarget>
          {driverProfile.isError ? (
            <Text style={[styles.hint, { color: palette.muted }]}>Driver access is temporarily unavailable. Your company workspace remains usable.</Text>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function WorkspaceCard({ title, description, icon, onPress, desktop, disabled = false }: {
  title: string;
  description: string;
  icon: ReactNode;
  onPress: () => void;
  desktop: boolean;
  disabled?: boolean;
}) {
  const { palette } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          width: desktop ? "48.5%" : "100%",
          backgroundColor: palette.surface,
          borderColor: palette.border,
          opacity: disabled ? 0.5 : 1,
          transform: [{ scale: pressed ? 0.99 : 1 }],
        },
      ]}
    >
      <View style={styles.tileTop}>
        <View style={[styles.tileIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View>
        <ChevronRight color={palette.muted} size={19} />
      </View>
      <Text style={[styles.tileTitle, { color: palette.ink }]}>{title}</Text>
      <Text style={[styles.body, { color: palette.muted }]}>{description}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  companyCard: { width: "100%", maxWidth: 820, alignSelf: "flex-start" },
  companyHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  companyIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  companyCopy: { flex: 1, minWidth: 0, gap: 3 },
  companyName: { ...typography.sectionTitle, fontSize: 17 },
  eyebrow: { ...typography.eyebrow, fontSize: 8 },
  title: { ...typography.sectionTitle, fontSize: 16 },
  body: { ...typography.caption, fontSize: 11, lineHeight: 17 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, maxWidth: 1000, alignItems: "stretch" },
  tile: { minHeight: 108, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md, gap: 6 },
  tileTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tileIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  tileTitle: { ...typography.bodyStrong, fontSize: 12 },
  hint: { ...typography.caption, fontSize: 10 },
});
