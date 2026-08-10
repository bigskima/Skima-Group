import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  displayTitle,
  firstNumber,
  firstString,
  recordId,
  type PlatformRecord,
} from "../api/records";
import { useSession } from "../session/SessionProvider";
import { draftStore } from "../storage/drafts";
import { colors, radii, spacing } from "../theme/tokens";
import { idempotencyKey } from "../utilities/idempotency";
import { Screen } from "./Screen";
const TYPE = "customer-refill-request";
export function NewRefillScreen() {
  const session = useSession();
  const owner = session.context?.profile?.id ?? session.context?.user.id ?? "";
  const dark = useColorScheme() === "dark";
  const cylinders = domainQueries.cylinders();
  const locations = domainQueries.locations();
  const stations = domainQueries.stations();
  const wallets = domainQueries.wallets();
  const quotes = domainQueries.quotes();
  const [cylinderId, setCylinderId] = useState("");
  const [pickupLocationId, setPickupLocationId] = useState("");
  const [deliveryLocationId, setDeliveryLocationId] = useState("");
  const [stationId, setStationId] = useState("");
  const [requestedKg, setRequestedKg] = useState("");
  const [instructions, setInstructions] = useState("");
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [quoteRecord, setQuoteRecord] = useState<PlatformRecord | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const draftCreatedAt = useRef(new Date().toISOString());
  const quote = useGatewayMutation({
    path: "/lpg/quotes",
    schema: ActionResponseSchema,
    invalidate: [["quotes"]],
  });
  const order = useGatewayMutation({
    path: "/lpg/orders",
    schema: ActionResponseSchema,
    invalidate: [["orders"], ["orders", "active"]],
  });
  const reserve = useGatewayMutation({
    path: "/lpg/orders/reserve-payment",
    schema: ActionResponseSchema,
    invalidate: [["orders"], ["orders", "active"], ["wallets"]],
  });
  useEffect(() => {
    if (!owner) return;
    void draftStore.load(owner, TYPE).then((draft) => {
      if (draft) {
        draftCreatedAt.current = draft.createdAt;
        setCylinderId(String(draft.values.cylinderId ?? ""));
        setPickupLocationId(String(draft.values.pickupLocationId ?? ""));
        setDeliveryLocationId(String(draft.values.deliveryLocationId ?? ""));
        setStationId(String(draft.values.stationId ?? ""));
        setRequestedKg(String(draft.values.requestedKg ?? ""));
        setInstructions(String(draft.values.instructions ?? ""));
        setOrderId(
          typeof draft.values.orderId === "string"
            ? draft.values.orderId
            : null,
        );
        const savedQuote = asRecord(draft.values.quoteRecord);
        const savedQuoteId =
          typeof draft.values.quoteId === "string"
            ? draft.values.quoteId
            : null;
        if (savedQuoteId && savedQuote && !quoteExpired(savedQuote)) {
          setQuoteId(savedQuoteId);
          setQuoteRecord(savedQuote);
        }
      }
      setHydrated(true);
    });
  }, [owner]);
  useEffect(() => {
    if (!owner || !hydrated) return;
    const now = new Date().toISOString();
    void draftStore.save({
      version: 1,
      type: TYPE,
      ownerProfileId: owner,
      step: orderId
        ? "payment-reservation"
        : quoteId
          ? "quote-review"
          : "selection",
      workflowId: orderId ?? quoteId ?? undefined,
      values: {
        cylinderId,
        pickupLocationId,
        deliveryLocationId,
        stationId,
        requestedKg,
        instructions,
        quoteId,
        quoteRecord,
        orderId,
      },
      pendingMedia: [],
      createdAt: draftCreatedAt.current,
      updatedAt: now,
    });
  }, [
    cylinderId,
    deliveryLocationId,
    hydrated,
    instructions,
    orderId,
    owner,
    pickupLocationId,
    quoteId,
    quoteRecord,
    requestedKg,
    stationId,
  ]);
  const requestQuote = async () => {
    setError(null);
    const kilograms = Number(requestedKg);
    if (!cylinderId || !pickupLocationId || !deliveryLocationId) {
      setError("Select a cylinder, pickup location, and delivery location.");
      return;
    }
    if (!Number.isFinite(kilograms) || kilograms <= 0) {
      setError("Enter the kilograms to refill.");
      return;
    }
    try {
      const result = await quote.mutateAsync({
        cylinderId,
        pickupLocationId,
        deliveryLocationId,
        stationBranchId: stationId || undefined,
        requestedKg: kilograms,
        deliveryInstructions: instructions.trim() || undefined,
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("create-quote", cylinderId),
      });
      const id = resultId(result);
      if (!id)
        throw new Error("The quote service did not return a quote identifier.");
      const refreshed = await quotes.refetch();
      setQuoteRecord(
        refreshed.data?.find((item) => recordId(item) === id) ??
          (typeof result === "object" && result ? result : null),
      );
      setQuoteId(id);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The quote could not be created.",
      );
    }
  };
  const createOrder = async () => {
    if (!quoteId) return;
    setError(null);
    try {
      let nextOrderId = orderId;
      if (!nextOrderId) {
        const result = await order.mutateAsync({
          lpgRefillQuoteId: quoteId,
          source: "skima.lpg.mobile",
          idempotencyKey: idempotencyKey("create-order", quoteId),
        });
        nextOrderId = resultId(result);
        if (!nextOrderId)
          throw new Error(
            "The order service did not return an order identifier.",
          );
        setOrderId(nextOrderId);
      }
      const walletId = firstString(wallets.data?.[0], [
        "wallet_id",
        "walletId",
      ]);
      await reserve.mutateAsync({
        lpgOrderId: nextOrderId,
        customerWalletId: walletId ?? undefined,
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("reserve-order-payment", nextOrderId),
      });
      await draftStore.clear(owner, TYPE);
      router.replace("/(customer)/orders");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The order could not be created.",
      );
    }
  };
  return (
    <Screen
      eyebrow="New refill"
      title={quoteId ? "Quote ready" : "Choose refill details"}
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
      }
    >
      {quoteId ? (
        <View
          style={[
            styles.quote,
            { backgroundColor: dark ? colors.darkSurface : colors.surface },
          ]}
        >
          <Text
            style={[
              styles.quoteTitle,
              { color: dark ? colors.darkInk : colors.ink },
            ]}
          >
            Backend quote received
          </Text>
          <QuoteLine
            label="Refill"
            value={money(
              firstNumber(quoteRecord, [
                "refillAmount",
                "refill_amount",
                "lpg_amount",
                "lpgAmount",
              ]),
              firstString(quoteRecord, ["currencyCode", "currency_code"]),
            )}
          />
          <QuoteLine
            label="Delivery"
            value={money(
              firstNumber(quoteRecord, [
                "deliveryAmount",
                "delivery_amount",
                "delivery_fee_amount",
                "deliveryFeeAmount",
              ]),
              firstString(quoteRecord, ["currencyCode", "currency_code"]),
            )}
          />
          <QuoteLine
            label="Total"
            value={money(
              firstNumber(quoteRecord, [
                "totalAmount",
                "total_amount",
                "quotedTotal",
                "total_amount",
              ]),
              firstString(quoteRecord, ["currencyCode", "currency_code"]),
            )}
          />
          <Text style={styles.muted}>
            Valid until{" "}
            {formatDate(firstString(quoteRecord, ["expiresAt", "expires_at"]))}.
            Pricing remains backend-authoritative.
          </Text>
          <Pressable
            disabled={order.isPending || reserve.isPending}
            onPress={() => void createOrder()}
            style={styles.primary}
          >
            {order.isPending || reserve.isPending ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.primaryText}>
                {orderId
                  ? "Retry payment reservation"
                  : "Place order and reserve payment"}
              </Text>
            )}
          </Pressable>
        </View>
      ) : (
        <>
          <Choice
            title="Cylinder"
            records={cylinders.data ?? []}
            selected={cylinderId}
            onSelect={setCylinderId}
          />
          <Choice
            title="Pickup location"
            records={locations.data ?? []}
            selected={pickupLocationId}
            onSelect={setPickupLocationId}
          />
          <Choice
            title="Delivery location"
            records={locations.data ?? []}
            selected={deliveryLocationId}
            onSelect={setDeliveryLocationId}
          />
          <TextInput
            value={requestedKg}
            onChangeText={setRequestedKg}
            keyboardType="decimal-pad"
            placeholder="Kilograms to refill"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <TextInput
            value={instructions}
            onChangeText={setInstructions}
            placeholder="Delivery instructions (optional)"
            placeholderTextColor={colors.muted}
            multiline
            style={[styles.input, styles.multiline]}
          />
          <Choice
            title="Station"
            records={stations.data ?? []}
            selected={stationId}
            onSelect={setStationId}
          />
          <Pressable onPress={() => void requestQuote()} style={styles.primary}>
            {quote.isPending ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.primaryText}>Request backend quote</Text>
            )}
          </Pressable>
        </>
      )}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Text style={styles.muted}>
        Selections are saved to this profile on this device until the request
        succeeds.
      </Text>
    </Screen>
  );
}
function Choice({
  title,
  records,
  selected,
  onSelect,
}: {
  title: string;
  records: PlatformRecord[];
  selected: string;
  onSelect(id: string): void;
}) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      {records.length ? (
        <View style={styles.choices}>
          {records.map((item, index) => {
            const id = recordId(item) ?? String(index);
            const active = id === selected;
            return (
              <Pressable
                key={id}
                onPress={() => onSelect(id)}
                style={[styles.choice, active && styles.choiceActive]}
              >
                <Text
                  style={[styles.choiceText, active && styles.choiceTextActive]}
                >
                  {displayTitle(item)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text style={styles.muted}>No available records returned.</Text>
      )}
    </View>
  );
}
function QuoteLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={quoteStyles.line}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={quoteStyles.amount}>{value}</Text>
    </View>
  );
}
function money(value: number | null, currency: string | null) {
  if (value === null) return "Backend calculated";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency ?? "NGN",
    }).format(value);
  } catch {
    return `${currency ?? ""} ${value.toFixed(2)}`.trim();
  }
}
function formatDate(value: string | null) {
  if (!value) return "the backend expiry";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function resultId(result: string | PlatformRecord | null): string | null {
  if (typeof result === "string") return result;
  return firstString(result, [
    "id",
    "lpgOrderId",
    "lpg_order_id",
    "lpgRefillQuoteId",
    "lpg_refill_quote_id",
  ]);
}
function asRecord(value: unknown): PlatformRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as PlatformRecord)
    : null;
}
function quoteExpired(quote: PlatformRecord) {
  const value = firstString(quote, ["expiresAt", "expires_at"]);
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}
const quoteStyles = StyleSheet.create({
  line: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  amount: { color: colors.ink, fontSize: 17, fontWeight: "900" },
});
const styles = StyleSheet.create({
  link: { color: colors.brand, fontWeight: "800" },
  group: { gap: spacing.sm },
  groupTitle: { color: colors.ink, fontSize: 17, fontWeight: "800" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  choiceActive: { borderColor: colors.brand, backgroundColor: "#DDF3E5" },
  choiceText: { color: colors.muted, fontWeight: "700" },
  choiceTextActive: { color: colors.brandDark },
  primary: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg,
  },
  primaryText: { color: "white", fontWeight: "800" },
  quote: { padding: spacing.lg, gap: spacing.md, borderRadius: radii.lg },
  quoteTitle: { fontSize: 20, fontWeight: "800" },
  error: { color: colors.danger },
  muted: { color: colors.muted, lineHeight: 21 },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    color: colors.ink,
    fontSize: 16,
  },
  multiline: {
    minHeight: 90,
    paddingTop: spacing.md,
    textAlignVertical: "top",
  },
});
