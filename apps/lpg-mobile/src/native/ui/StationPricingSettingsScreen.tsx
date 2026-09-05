import { router } from "expo-router";
import { BadgeDollarSign, ShieldCheck, Store } from "lucide-react-native";
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
import { StatusPill } from "./StatusPill";

export function StationPricingSettingsScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const hasPermission = (permission: string) =>
    Boolean(
      session.context?.platformAdmin ||
        session.context?.permissions.includes(permission) ||
        session.context?.roles.some((role) => role.permissions.includes(permission)),
    );

  const canManage = hasPermission("business.partner_price.manage") ||
    hasPermission("platform.partner_price.manage") ||
    hasPermission("lpg.stations.manage");

  const runtime = useStationRuntime();
  const branch = nestedRecord(runtime.data, "branch");
  const branchId = branch ? recordId(branch) : null;
  const catalogPrices = domainQueries.stationCatalogPrices(branchId);
  const pricing = catalogPrices.data?.[0] ?? nestedRecords(runtime.data, "pricing")[0];
  const catalogItemId = firstString(pricing, ["itemId", "item_id"]);

  const [price, setPrice] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeSuccess, setNoticeSuccess] = useState(false);

  const mutation = useGatewayMutation({
    path: "/lpg/config",
    schema: ActionResponseSchema,
    invalidate: [["station-runtime"], ["station-catalog-prices"]],
  });

  useEffect(() => {
    const amount = firstNumber(pricing, ["pricePerKg", "price_per_kg"]);
    setPrice(amount === null ? "" : String(amount));
  }, [pricing]);

  const save = async () => {
    setNotice(null);
    const amount = Number(price);

    if (!canManage) {
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
      setNotice("LPG refill pricing is not ready for this branch yet.");
      return;
    }

    try {
      await mutation.mutateAsync({
        configType: "stationPrice",
        itemId: catalogItemId,
        stationBranchId: branchId,
        pricePerKg: amount,
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("station-price", branchId),
      });
      setNoticeSuccess(true);
      setNotice("Station selling price updated.");
    } catch (cause) {
      setNoticeSuccess(false);
      setNotice(friendlyError(cause, "Station pricing could not be updated."));
    }
  };

  return (
    <Screen
      eyebrow="Station settings"
      title="LPG selling price"
      subtitle="Set only this branch's LPG price per kilogram."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      {runtime.isPending || catalogPrices.isPending ? (
        <ScreenSkeleton cards={1} />
      ) : runtime.error || catalogPrices.error || !branch ? (
        <EmptyState
          icon={<Store color={palette.brand} size={27} />}
          title="Pricing unavailable"
          description="The branch pricing details could not be loaded."
          action={<AppButton label="Retry" onPress={() => void Promise.all([runtime.refetch(), catalogPrices.refetch()])} />}
        />
      ) : (
        <>
          <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.heroTop}>
              <View style={styles.heroCopy}>
                <Text style={styles.heroEyebrow}>CURRENT SELLING PRICE</Text>
                <Text style={styles.heroTitle}>
                  {price ? `₦${Number(price).toLocaleString()}` : "Not set"}
                </Text>
                <Text style={styles.heroUnit}>per kilogram</Text>
              </View>
              <View style={styles.heroIcon}><BadgeDollarSign color="#FFFFFF" size={25} /></View>
            </View>
          </View>

          <View style={[styles.card, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.lead}>
              <View style={[styles.iconWrap, { backgroundColor: palette.brandSoft }]}><BadgeDollarSign color={palette.brand} size={22} /></View>
              <View style={styles.copy}>
                <Text style={[styles.title, { color: palette.ink }]}>Branch price per kg</Text>
                <Text style={[styles.body, { color: palette.muted }]}>
                  SKIMA adds any separate platform or delivery charges automatically.
                </Text>
              </View>
            </View>

            {catalogItemId ? (
              <View style={[styles.catalogRow, { backgroundColor: palette.surfaceSubtle }]}>
                <Store color={palette.mutedStrong} size={18} />
                <View style={styles.catalogCopy}>
                  <Text style={[styles.catalogLabel, { color: palette.muted }]}>LPG SERVICE</Text>
                  <Text style={[styles.catalogValue, { color: palette.ink }]}>
                    {firstString(pricing, ["displayName", "display_name", "itemKey"]) ?? "LPG refill"}
                  </Text>
                </View>
                <StatusPill label="Active" tone="success" />
              </View>
            ) : (
              <View style={[styles.warning, { backgroundColor: palette.warningSoft }]}>
                <Store color={palette.warning} size={19} />
                <Text style={[styles.warningText, { color: palette.ink }]}>
                  LPG refill pricing is not ready for this branch yet. Contact SKIMA support if this continues.
                </Text>
              </View>
            )}

            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: palette.ink }]}>Selling price per kilogram</Text>
              <TextInput
                editable={canManage && Boolean(catalogItemId)}
                value={price}
                onChangeText={setPrice}
                keyboardType="decimal-pad"
                placeholder="Enter price per kg"
                placeholderTextColor={palette.muted}
                style={[
                  styles.input,
                  {
                    backgroundColor: palette.input,
                    borderColor: palette.borderStrong,
                    color: palette.ink,
                    opacity: canManage && catalogItemId ? 1 : 0.65,
                  },
                ]}
              />
              <Text style={[styles.fieldHint, { color: palette.muted }]}>
                Enter only the station's LPG selling price.
              </Text>
            </View>

            {canManage ? (
              <AppButton
                label="Update price"
                fullWidth
                loading={mutation.isPending}
                disabled={!catalogItemId}
                onPress={() => void save()}
              />
            ) : (
              <PermissionNotice text="Branch pricing is read-only for your current station role." />
            )}
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

const styles = StyleSheet.create({
  hero: { gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  heroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  heroCopy: { flex: 1, gap: 2 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 9 },
  heroTitle: { color: "#FFFFFF", ...typography.title, fontSize: 31 },
  heroUnit: { color: "rgba(255,255,255,.82)", ...typography.caption },
  heroIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  card: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  lead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  iconWrap: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, gap: 3 },
  title: { ...typography.subheading, fontSize: 15 },
  body: { ...typography.caption, lineHeight: 18 },
  catalogRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: radii.md, padding: spacing.md },
  catalogCopy: { flex: 1, gap: 2 },
  catalogLabel: { ...typography.eyebrow, fontSize: 8 },
  catalogValue: { ...typography.bodyStrong, fontSize: 14 },
  warning: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderRadius: radii.md, padding: spacing.md },
  warningText: { flex: 1, ...typography.caption, lineHeight: 18 },
  fieldGroup: { gap: spacing.sm },
  fieldLabel: { ...typography.caption, fontSize: 13, fontWeight: "900" },
  fieldHint: { ...typography.caption, lineHeight: 18 },
  input: { minHeight: 54, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, fontSize: 16 },
  permission: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md },
  permissionText: { flex: 1, ...typography.caption, lineHeight: 18 },
  notice: { borderRadius: radii.md, padding: spacing.md },
  noticeText: { ...typography.caption, fontWeight: "800", textAlign: "center" },
});
