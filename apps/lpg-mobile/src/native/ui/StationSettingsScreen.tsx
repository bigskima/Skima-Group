import { router } from "expo-router";
import { BadgeDollarSign, Clock3, Power, ShieldCheck, Store } from "lucide-react-native";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { domainQueries, useStationRuntime } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  firstNumber,
  firstString,
  nestedRecord,
  nestedRecords,
  recordId,
} from "../api/records";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "./StatusPill";

export function StationSettingsScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const hasPermission = (permission: string) =>
    Boolean(
      session.context?.platformAdmin ||
        session.context?.permissions.includes(permission) ||
        session.context?.roles.some((role) => role.permissions.includes(permission)),
    );
  const canManageOperations = hasPermission("lpg.stations.manage");
  const canManagePrice = hasPermission("business.partner_price.manage") ||
    hasPermission("platform.partner_price.manage") ||
    canManageOperations;
  const canViewSettings = canManageOperations || canManagePrice;

  const runtime = useStationRuntime();
  const branch = nestedRecord(runtime.data, "branch");
  const branchId = branch ? recordId(branch) : null;
  const catalogPrices = domainQueries.stationCatalogPrices(branchId);
  const hours = nestedRecord(branch, "operatingHours") ?? nestedRecord(branch, "operating_hours");
  const pricing = catalogPrices.data?.[0] ?? nestedRecords(runtime.data, "pricing")[0];
  const catalogItemId = firstString(pricing, ["itemId", "item_id"]);
  const [availability, setAvailability] = useState("available");
  const [opens, setOpens] = useState("");
  const [closes, setCloses] = useState("");
  const [price, setPrice] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeSuccess, setNoticeSuccess] = useState(false);

  const operations = useGatewayMutation({
    path: "/lpg/stations/settings",
    schema: ActionResponseSchema,
    invalidate: [["station-runtime"], ["stations"]],
  });
  const pricingMutation = useGatewayMutation({
    path: "/lpg/config",
    schema: ActionResponseSchema,
    invalidate: [["station-runtime"], ["station-catalog-prices"]],
  });

  useEffect(() => {
    if (branch) {
      setAvailability(
        firstString(branch, ["availabilityStatus", "availability_status"]) ?? "available",
      );
      setOpens(firstString(hours, ["opensAt", "opens_at"]) ?? "");
      setCloses(firstString(hours, ["closesAt", "closes_at"]) ?? "");
    }
    const amount = firstNumber(pricing, ["pricePerKg", "price_per_kg"]);
    setPrice(amount === null ? "" : String(amount));
  }, [branch, hours, pricing]);

  const saveOperations = async () => {
    setNotice(null);
    if (!canManageOperations || !branchId) {
      setNoticeSuccess(false);
      setNotice("Your current station role cannot change operating settings.");
      return;
    }
    try {
      await operations.mutateAsync({
        stationBranchId: branchId,
        availabilityStatus: availability,
        operatingHours: { opensAt: opens, closesAt: closes },
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("station-settings", branchId),
      });
      setNoticeSuccess(true);
      setNotice("Station operating settings updated successfully.");
    } catch (cause) {
      setNoticeSuccess(false);
      setNotice(friendlyError(cause, "Station operating settings could not be saved."));
    }
  };

  const savePrice = async () => {
    setNotice(null);
    const amount = Number(price);
    if (!canManagePrice) {
      setNoticeSuccess(false);
      setNotice("Your current station role cannot change the branch refill price.");
      return;
    }
    if (!branchId || !Number.isFinite(amount) || amount <= 0) {
      setNoticeSuccess(false);
      setNotice("Enter a valid station selling price per kilogram.");
      return;
    }
    if (!catalogItemId) {
      setNoticeSuccess(false);
      setNotice("An active LPG refill catalog item is required before this station can set its price.");
      return;
    }
    try {
      await pricingMutation.mutateAsync({
        configType: "stationPrice",
        itemId: catalogItemId,
        stationBranchId: branchId,
        pricePerKg: amount,
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("station-price", branchId),
      });
      setNoticeSuccess(true);
      setNotice("Station refill price updated successfully.");
    } catch (cause) {
      setNoticeSuccess(false);
      setNotice(friendlyError(cause, "Station pricing could not be updated."));
    }
  };

  if (!canViewSettings) {
    return (
      <Screen
        eyebrow="Station operations"
        title="Settings & pricing"
        subtitle="Only authorised station team members can manage these settings."
      >
        <EmptyState
          icon={<ShieldCheck color={palette.brand} size={27} />}
          title="Settings access restricted"
          description="Your current station role does not include operating-settings or branch-pricing permissions."
          action={<AppButton label="Back" variant="secondary" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  return (
    <Screen
      eyebrow="Station operations"
      title="Settings & pricing"
      subtitle="Manage branch availability, operating hours and the station's own LPG selling price within your permissions."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      {runtime.isPending || catalogPrices.isPending ? (
        <ScreenSkeleton cards={3} />
      ) : runtime.error || catalogPrices.error ? (
        <EmptyState
          icon={<Store color={palette.brand} size={27} />}
          title="Station settings could not be loaded"
          description="Check your connection and refresh this station workspace."
          action={<AppButton label="Retry" onPress={() => void Promise.all([runtime.refetch(), catalogPrices.refetch()])} />}
        />
      ) : (
        <>
          <View style={[styles.hero, shadows.raised, { backgroundColor: availability === "available" ? palette.brand : palette.ink }]}>
            <View style={styles.heroTop}>
              <View style={styles.heroCopy}>
                <Text style={styles.heroEyebrow}>BRANCH OPERATING STATUS</Text>
                <Text style={styles.heroTitle}>{availabilityLabel(availability)}</Text>
              </View>
              <View style={styles.heroIcon}><Power color="#FFFFFF" size={26} /></View>
            </View>
            <Text style={styles.heroBody}>{availabilityDescription(availability)}</Text>
            <View style={styles.heroFooter}>
              <StatusPill
                label={availabilityLabel(availability)}
                tone={availability === "available" ? "success" : availability === "paused" ? "warning" : "neutral"}
              />
              <Text style={styles.heroHours}>{opens && closes ? `${opens} – ${closes}` : "Hours not fully set"}</Text>
            </View>
          </View>

          <SectionHeader
            title="Operating availability"
            description="Choose whether this branch is ready to receive LPG orders."
          />

          <View style={[styles.card, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.sectionLead}>
              <View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}><Power color={palette.brand} size={21} /></View>
              <View style={styles.sectionCopy}>
                <Text style={[styles.sectionTitle, { color: palette.ink }]}>Branch status</Text>
                <Text style={[styles.sectionBody, { color: palette.muted }]}>{canManageOperations ? "Choose the current operating state for this branch." : "Your role can view this setting but cannot change it."}</Text>
              </View>
            </View>

            <View style={styles.choices}>
              {["available", "paused", "closed", "unavailable"].map((value) => (
                <AppButton
                  key={value}
                  label={availabilityLabel(value)}
                  size="sm"
                  variant={availability === value ? "primary" : "secondary"}
                  disabled={!canManageOperations}
                  onPress={() => setAvailability(value)}
                />
              ))}
            </View>

            <View style={[styles.divider, { backgroundColor: palette.border }]} />

            <View style={styles.sectionLead}>
              <View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}><Clock3 color={palette.brand} size={21} /></View>
              <View style={styles.sectionCopy}>
                <Text style={[styles.sectionTitle, { color: palette.ink }]}>Operating hours</Text>
                <Text style={[styles.sectionBody, { color: palette.muted }]}>Use 24-hour time, for example 08:00 to 18:00.</Text>
              </View>
            </View>

            <View style={styles.timeGrid}>
              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: palette.ink }]}>Opens</Text>
                <TextInput
                  editable={canManageOperations}
                  value={opens}
                  onChangeText={setOpens}
                  placeholder="08:00"
                  placeholderTextColor={palette.muted}
                  autoCapitalize="none"
                  style={[styles.input, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink, opacity: canManageOperations ? 1 : 0.65 }]}
                />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: palette.ink }]}>Closes</Text>
                <TextInput
                  editable={canManageOperations}
                  value={closes}
                  onChangeText={setCloses}
                  placeholder="18:00"
                  placeholderTextColor={palette.muted}
                  autoCapitalize="none"
                  style={[styles.input, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink, opacity: canManageOperations ? 1 : 0.65 }]}
                />
              </View>
            </View>

            {canManageOperations ? (
              <AppButton label="Save operating settings" fullWidth loading={operations.isPending} onPress={() => void saveOperations()} />
            ) : (
              <PermissionNotice text="Operating settings are read-only for your current station role." />
            )}
          </View>

          <SectionHeader
            title="Station refill price"
            description="Set this branch's LPG selling price per kilogram. Any separate SKIMA charges are added automatically."
          />

          <View style={[styles.card, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.sectionLead}>
              <View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}><BadgeDollarSign color={palette.brand} size={22} /></View>
              <View style={styles.sectionCopy}>
                <Text style={[styles.sectionTitle, { color: palette.ink }]}>Branch price per kg</Text>
                <Text style={[styles.sectionBody, { color: palette.muted }]}>This is the station's LPG selling price. The customer total may include separate SKIMA charges.</Text>
              </View>
            </View>

            {catalogItemId ? (
              <View style={[styles.catalogRow, { backgroundColor: palette.surfaceSubtle }]}>
                <Store color={palette.mutedStrong} size={18} />
                <View style={styles.catalogCopy}>
                  <Text style={[styles.catalogLabel, { color: palette.muted }]}>CURRENT LPG SERVICE</Text>
                  <Text style={[styles.catalogValue, { color: palette.ink }]}>{firstString(pricing, ["displayName", "display_name", "itemKey"]) ?? "LPG refill"}</Text>
                </View>
                <StatusPill label="Active" tone="success" />
              </View>
            ) : (
              <View style={[styles.warning, { backgroundColor: palette.warningSoft }]}>
                <Store color={palette.warning} size={19} />
                <Text style={[styles.warningText, { color: palette.ink }]}>LPG refill pricing is not ready for this branch yet. Contact SKIMA support if this continues.</Text>
              </View>
            )}

            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: palette.ink }]}>Selling price per kilogram</Text>
              <TextInput
                editable={canManagePrice && Boolean(catalogItemId)}
                value={price}
                onChangeText={setPrice}
                keyboardType="decimal-pad"
                placeholder="Enter station price per kg"
                placeholderTextColor={palette.muted}
                style={[styles.input, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink, opacity: canManagePrice && catalogItemId ? 1 : 0.65 }]}
              />
              <Text style={[styles.fieldHint, { color: palette.muted }]}>Enter only the station's LPG price. SKIMA will add any separate charges automatically.</Text>
            </View>

            {canManagePrice ? (
              <AppButton
                label="Update station price"
                fullWidth
                variant="secondary"
                loading={pricingMutation.isPending}
                disabled={!catalogItemId}
                onPress={() => void savePrice()}
              />
            ) : (
              <PermissionNotice text="Branch pricing is read-only for your current station role." />
            )}
          </View>

          <View style={[styles.policyNote, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <ShieldCheck color={palette.mutedStrong} size={18} />
            <Text style={[styles.policyText, { color: palette.muted }]}>Only authorised team members can change these settings. SKIMA manages any charges outside the station's selling price.</Text>
          </View>

          {notice ? (
            <View style={[styles.notice, { backgroundColor: noticeSuccess ? palette.successSoft : palette.dangerSoft }]}>
              <Text accessibilityRole="alert" style={[styles.noticeText, { color: noticeSuccess ? palette.success : palette.danger }]}>{notice}</Text>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function PermissionNotice({ text }: { text: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.permission, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
      <ShieldCheck color={palette.mutedStrong} size={18} />
      <Text style={[styles.permissionText, { color: palette.muted }]}>{text}</Text>
    </View>
  );
}

function availabilityLabel(value: string) {
  const labels: Record<string, string> = {
    available: "Available",
    paused: "Paused",
    closed: "Closed",
    unavailable: "Unavailable",
  };
  return labels[value] ?? value.replace(/[_-]/g, " ");
}

function availabilityDescription(value: string) {
  if (value === "available") return "The branch is presented as operationally available for eligible SKIMA LPG fulfilment.";
  if (value === "paused") return "The branch is temporarily paused and should not receive new eligible work until resumed.";
  if (value === "closed") return "The branch is marked closed for the current operating period.";
  return "The branch is unavailable for new eligible LPG fulfilment until its status changes.";
}

const styles = StyleSheet.create({
  hero: { gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  heroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  heroCopy: { flex: 1, gap: 3 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 9 },
  heroTitle: { color: "#FFFFFF", ...typography.title, fontSize: 27 },
  heroIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  heroBody: { color: "rgba(255,255,255,.84)", ...typography.caption, lineHeight: 18 },
  heroFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  heroHours: { color: "rgba(255,255,255,.86)", ...typography.caption, fontWeight: "800" },
  card: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  sectionLead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  sectionIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  sectionCopy: { flex: 1, gap: 3 },
  sectionTitle: { ...typography.subheading, fontSize: 15 },
  sectionBody: { ...typography.caption, lineHeight: 18 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth },
  timeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  fieldGroup: { flex: 1, minWidth: 130, gap: spacing.sm },
  fieldLabel: { ...typography.caption, fontSize: 13, fontWeight: "900" },
  fieldHint: { ...typography.caption, lineHeight: 18 },
  input: { minHeight: 54, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, fontSize: 16 },
  catalogRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: radii.md, padding: spacing.md },
  catalogCopy: { flex: 1, gap: 2 },
  catalogLabel: { ...typography.eyebrow, fontSize: 8 },
  catalogValue: { ...typography.bodyStrong, fontSize: 14 },
  warning: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderRadius: radii.md, padding: spacing.md },
  warningText: { flex: 1, ...typography.caption, lineHeight: 18 },
  permission: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md },
  permissionText: { flex: 1, ...typography.caption, lineHeight: 18 },
  policyNote: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  policyText: { flex: 1, ...typography.caption, lineHeight: 18 },
  notice: { borderRadius: radii.md, padding: spacing.md },
  noticeText: { ...typography.caption, fontWeight: "800", textAlign: "center" },
});
