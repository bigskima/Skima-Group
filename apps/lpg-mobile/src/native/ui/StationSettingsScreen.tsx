import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
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
import { colors, radii, spacing } from "../theme/tokens";
import { idempotencyKey } from "../utilities/idempotency";
import { Card } from "./Card";
import { Screen } from "./Screen";
import { useSession } from "../session/SessionProvider";
export function StationSettingsScreen() {
  const session = useSession();
  const canManage = Boolean(
    session.context?.platformAdmin ||
    session.context?.permissions.includes("platform.partner_price.manage") ||
    session.context?.permissions.includes("lpg.stations.manage") ||
    session.context?.roles.some((role) =>
      role.permissions.includes("platform.partner_price.manage") ||
      role.permissions.includes("lpg.stations.manage"),
    ),
  );
  const runtime = useStationRuntime();
  const catalogPrices = domainQueries.stationCatalogPrices();
  const branch = nestedRecord(runtime.data, "branch");
  const branchId = branch ? recordId(branch) : null;
  const hours =
    nestedRecord(branch, "operatingHours") ??
    nestedRecord(branch, "operating_hours");
  const pricing = catalogPrices.data?.[0] ?? nestedRecords(runtime.data, "pricing")[0];
  const catalogItemId = firstString(pricing, ["itemId", "item_id"]);
  const [availability, setAvailability] = useState("available");
  const [opens, setOpens] = useState("");
  const [closes, setCloses] = useState("");
  const [price, setPrice] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
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
        firstString(branch, ["availabilityStatus", "availability_status"]) ??
          "available",
      );
      setOpens(firstString(hours, ["opensAt", "opens_at"]) ?? "");
      setCloses(firstString(hours, ["closesAt", "closes_at"]) ?? "");
    }
    const amount = firstNumber(pricing, ["pricePerKg", "price_per_kg"]);
    setPrice(amount === null ? "" : String(amount));
  }, [branch, hours, pricing]);
  const saveOperations = async () => {
    if (!canManage || !branchId) {
      setNotice("No accessible station branch was returned.");
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
      setNotice("Station operations updated.");
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "Station settings could not be saved.",
      );
    }
  };
  const savePrice = async () => {
    const amount = Number(price);
    if (!branchId || !Number.isFinite(amount) || amount <= 0) {
      setNotice("Enter a valid branch price per kilogram.");
      return;
    }
    if (!catalogItemId) {
      setNotice("Add an active LPG refill item to this branch catalog before setting its price.");
      return;
    }
    try {
      await pricingMutation.mutateAsync({
        configType: "stationPrice",
        itemId: catalogItemId ?? undefined,
        stationBranchId: branchId,
        pricePerKg: amount,
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("station-price", branchId),
      });
      setNotice("Branch price updated.");
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "Pricing could not be updated.",
      );
    }
  };
  if (!canManage) {
    return (
      <Screen eyebrow="Station operations" title="Settings and pricing">
        <Card>
          <Text style={styles.title}>Access restricted</Text>
          <Text style={styles.body}>
            Your station access does not include settings management.
          </Text>
        </Card>
      </Screen>
    );
  }
  return (
    <Screen
      eyebrow="Station operations"
      title="Settings and pricing"
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
      }
    >
      {runtime.isPending ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <>
          <Card>
            <Text style={styles.title}>Operating status</Text>
            <View style={styles.choices}>
              {["available", "paused", "closed", "unavailable"].map((value) => (
                <Pressable
                  key={value}
                  onPress={() => setAvailability(value)}
                  style={[
                    styles.choice,
                    availability === value && styles.active,
                  ]}
                >
                  <Text
                    style={[
                      styles.choiceText,
                      availability === value && styles.activeText,
                    ]}
                  >
                    {value}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={opens}
              onChangeText={setOpens}
              placeholder="Opens at, e.g. 08:00"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <TextInput
              value={closes}
              onChangeText={setCloses}
              placeholder="Closes at, e.g. 18:00"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <Pressable
              disabled={operations.isPending}
              onPress={() => void saveOperations()}
              style={styles.primary}
            >
              {operations.isPending ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.primaryText}>Save operations</Text>
              )}
            </Pressable>
          </Card>
          <Card>
            <Text style={styles.title}>Controlled branch pricing</Text>
            <Text style={styles.body}>
              Only refill price is editable here. Delivery, tax, platform, and
              driver amounts remain server-managed by policy.
            </Text>
            {catalogItemId ? (
              <Text style={styles.body}>
                Editing {firstString(pricing, ["displayName", "display_name", "itemKey"]) ?? "LPG refill"}.
              </Text>
            ) : (
              <Text style={styles.warning}>
                No active LPG refill catalog item is configured for this branch.
              </Text>
            )}
            <TextInput
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
              placeholder="Price per kilogram"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <Pressable
              disabled={pricingMutation.isPending || !catalogItemId}
              onPress={() => void savePrice()}
              style={styles.secondary}
            >
              {pricingMutation.isPending ? (
                <ActivityIndicator color={colors.brand} />
              ) : (
                <Text style={styles.secondaryText}>Update branch price</Text>
              )}
            </Pressable>
          </Card>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        </>
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  back: { color: colors.brand, fontWeight: "800" },
  title: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  body: { color: colors.muted, lineHeight: 20 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  active: { borderColor: colors.brand, backgroundColor: "#FFF0F1" },
  choiceText: {
    color: colors.muted,
    textTransform: "capitalize",
    fontWeight: "700",
  },
  activeText: { color: colors.brand },
  input: {
    minHeight: 54,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    color: colors.ink,
  },
  primary: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  primaryText: { color: "white", fontWeight: "900" },
  secondary: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  secondaryText: { color: colors.brand, fontWeight: "900" },
  notice: { color: colors.success, fontWeight: "700" },
  warning: { color: colors.danger, fontWeight: "700" },
});
