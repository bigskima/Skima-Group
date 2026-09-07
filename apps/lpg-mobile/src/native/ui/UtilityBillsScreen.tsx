import { createClientIdempotencyKey } from "@skima/frontend-core";
import { router } from "expo-router";
import {
  BadgePercent,
  ChevronRight,
  Gift,
  Phone,
  ReceiptText,
  Sparkles,
  WalletCards,
  Wifi,
  Zap,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";

import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import { firstNumber, firstString, type PlatformRecord } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { selectWorkspaceWallet, walletRecordId } from "../utilities/financeWallet";
import { friendlyError } from "../utilities/friendlyError";
import { AppButton } from "./AppButton";
import { AppField } from "./AppField";
import { AppModal } from "./AppModal";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";

const MutationSchema = z.string().uuid();
const DEFAULT_PRODUCT_LIMIT = 6;
const DEFAULT_HISTORY_LIMIT = 3;

type CatalogGroup = {
  key: string;
  name: string;
  icon: string;
  products: PlatformRecord[];
};

export function UtilityBillsScreen() {
  const { palette } = useAppTheme();
  const catalog = domainQueries.utilityCatalog();
  const wallets = domainQueries.wallets();
  const offers = domainQueries.utilityOffers();
  const payments = domainQueries.utilityPayments();

  const [activeCategory, setActiveCategory] = useState("");
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [product, setProduct] = useState<PlatformRecord | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [promo, setPromo] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const createPayment = useGatewayMutation({
    path: "/runtime/utility-billing/requests",
    schema: MutationSchema,
    invalidate: [["utility-billing", "requests"], ["wallets"]],
  });

  const categories = useMemo(() => groupCatalog(catalog.data ?? []), [catalog.data]);

  useEffect(() => {
    if (!categories.length) {
      setActiveCategory("");
      return;
    }
    if (!categories.some((item) => item.key === activeCategory)) {
      setActiveCategory(categories[0].key);
      setShowAllProducts(false);
    }
  }, [activeCategory, categories]);

  const activeGroup =
    categories.find((item) => item.key === activeCategory) ??
    categories[0] ??
    null;

  const selectedCurrency = firstString(product, ["currency_code", "currencyCode"]) ?? "NGN";
  const wallet = selectWorkspaceWallet(
    (wallets.data ?? []).filter(
      (item) =>
        (firstString(item, ["currency_code", "currencyCode"]) ?? "NGN") ===
        selectedCurrency,
    ),
    "customer",
  );
  const walletId = walletRecordId(wallet);
  const balance =
    firstNumber(wallet, ["available_balance", "availableBalance", "balance"]) ?? 0;
  const currency = firstString(wallet, ["currency_code", "currencyCode"]) ?? "NGN";

  const fixedAmount = firstNumber(product, ["fixed_amount", "fixedAmount"]);
  const numericAmount = fixedAmount ?? Number(amount);
  const canSubmit =
    Boolean(product && walletId && identifier.trim()) &&
    Number.isFinite(numericAmount) &&
    numericAmount > 0;

  const visibleProducts =
    activeGroup?.products.slice(
      0,
      showAllProducts ? activeGroup.products.length : DEFAULT_PRODUCT_LIMIT,
    ) ?? [];
  const paymentRows = payments.data ?? [];
  const visiblePayments = paymentRows.slice(
    0,
    showAllHistory ? paymentRows.length : DEFAULT_HISTORY_LIMIT,
  );
  const visibleOffers = (offers.data ?? []).slice(0, 2);
  const extraOffers = Math.max(0, (offers.data?.length ?? 0) - visibleOffers.length);

  const chooseCategory = (key: string) => {
    setActiveCategory(key);
    setShowAllProducts(false);
  };

  const chooseProduct = (nextProduct: PlatformRecord) => {
    setProduct(nextProduct);
    setIdentifier("");
    setAmount("");
    setPhone("");
    setShowOptionalFields(false);
    setNotice(null);
  };

  const closePayment = () => {
    if (createPayment.isPending) return;
    setProduct(null);
    setIdentifier("");
    setAmount("");
    setPhone("");
    setShowOptionalFields(false);
  };

  const submit = async () => {
    if (!product || !walletId || !canSubmit) return;
    try {
      await createPayment.mutateAsync({
        productId: firstString(product, ["product_id"]),
        walletId,
        customerIdentifier: identifier.trim(),
        amount: numericAmount,
        recipientPhone: phone.trim() || undefined,
        promotionKey: promo.trim() || undefined,
        idempotencyKey: createClientIdempotencyKey(
          "utility-payment",
          firstString(product, ["product_id"]) ?? "product",
        ),
        metadata: { channel: "lpg-mobile" },
      });

      setProduct(null);
      setIdentifier("");
      setAmount("");
      setPhone("");
      setPromo("");
      setShowOptionalFields(false);
      setNotice(
        "Your request has been received. Your wallet is used only when the bill payment is confirmed.",
      );
    } catch (cause) {
      setNotice(
        friendlyError(
          cause,
          "The bill payment could not be prepared. Check the details and try again.",
        ),
      );
    }
  };

  return (
    <Screen
      eyebrow="Everyday services"
      title="Pay bills"
      subtitle="Choose a service, select what you want to pay for, then confirm the details."
      action={
        <AppButton
          label="Back"
          size="sm"
          variant="ghost"
          onPress={() => router.back()}
        />
      }
    >
      <View
        style={[
          styles.walletCard,
          shadows.raised,
          { backgroundColor: palette.elevated, borderColor: palette.border },
        ]}
      >
        <View style={[styles.walletIcon, { backgroundColor: palette.brandSoft }]}>
          <WalletCards color={palette.brand} size={22} />
        </View>
        <View style={styles.walletCopy}>
          <Text style={[styles.walletLabel, { color: palette.muted }]}>
            AVAILABLE BALANCE
          </Text>
          <Text
            adjustsFontSizeToFit
            numberOfLines={1}
            style={[styles.walletValue, { color: palette.ink }]}
          >
            {formatMajorMoney(balance, currency)}
          </Text>
        </View>
        <Text style={[styles.walletHint, { color: palette.muted }]}>
          Wallet
        </Text>
      </View>

      {visibleOffers.length ? (
        <View style={styles.offerSection}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={[styles.sectionEyebrow, { color: palette.brand }]}>
                OFFERS
              </Text>
              <Text style={[styles.sectionTitle, { color: palette.ink }]}>
                Available savings
              </Text>
            </View>
            {extraOffers ? (
              <Text style={[styles.sectionCount, { color: palette.muted }]}>
                +{extraOffers} more
              </Text>
            ) : null}
          </View>

          <View style={styles.offerStrip}>
            {visibleOffers.map((offer) => {
              const cashback =
                firstString(offer, ["offer_type"]) === "cashback";
              const offerKey = firstString(offer, ["offer_key"]) ?? "";
              const applied = !cashback && promo === offerKey;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    cashback
                      ? `${firstString(offer, ["offer_name"]) ?? "Cashback"} details`
                      : `${applied ? "Remove" : "Apply"} ${firstString(offer, ["offer_name"]) ?? "offer"}`
                  }
                  key={offerKey}
                  onPress={() => {
                    if (!cashback) setPromo(applied ? "" : offerKey);
                  }}
                  style={({ pressed }) => [
                    styles.offerCard,
                    {
                      backgroundColor: cashback
                        ? palette.successSoft
                        : palette.brandSoft,
                      borderColor: applied ? palette.brand : palette.border,
                      opacity: pressed ? 0.76 : 1,
                    },
                  ]}
                >
                  {cashback ? (
                    <Gift color={palette.success} size={19} />
                  ) : (
                    <BadgePercent color={palette.brand} size={19} />
                  )}
                  <View style={styles.offerCopy}>
                    <Text
                      style={[
                        styles.offerValue,
                        { color: cashback ? palette.success : palette.brand },
                      ]}
                    >
                      {firstString(offer, ["value_label"]) ?? "Offer"}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[styles.offerName, { color: palette.ink }]}
                    >
                      {firstString(offer, ["offer_name"]) ?? "Bill offer"}
                    </Text>
                  </View>
                  {!cashback ? (
                    <Text
                      style={[
                        styles.offerState,
                        { color: applied ? palette.brand : palette.muted },
                      ]}
                    >
                      {applied ? "Applied" : "Apply"}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {catalog.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.brand} size="large" />
          <Text style={[styles.loadingText, { color: palette.muted }]}>
            Loading bill services…
          </Text>
        </View>
      ) : catalog.error ? (
        <EmptyState
          title="Bills are unavailable"
          description="We could not load bill services. Try again shortly."
          action={
            <AppButton label="Retry" onPress={() => void catalog.refetch()} />
          }
        />
      ) : categories.length === 0 ? (
        <EmptyState
          title="More services are coming"
          description="Electricity, airtime, data and other bill services will appear here when they are available."
        />
      ) : (
        <>
          <View style={styles.categorySection}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={[styles.sectionEyebrow, { color: palette.brand }]}>
                  CHOOSE SERVICE
                </Text>
                <Text style={[styles.sectionTitle, { color: palette.ink }]}>
                  What are you paying for?
                </Text>
              </View>
              <Text style={[styles.sectionCount, { color: palette.muted }]}>
                {categories.length} services
              </Text>
            </View>

            <View style={styles.categoryGrid}>
              {categories.map((category) => {
                const selected = category.key === activeGroup?.key;
                return (
                  <Pressable
                    key={category.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => chooseCategory(category.key)}
                    style={({ pressed }) => [
                      styles.categoryChip,
                      {
                        backgroundColor: selected
                          ? palette.brandSoft
                          : palette.surface,
                        borderColor: selected
                          ? palette.brand
                          : palette.border,
                        opacity: pressed ? 0.78 : 1,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.categoryIcon,
                        {
                          backgroundColor: selected
                            ? palette.brand
                            : palette.surfaceSubtle,
                        },
                      ]}
                    >
                      {serviceIcon(
                        category.icon,
                        selected ? "#FFFFFF" : palette.brand,
                        18,
                      )}
                    </View>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.categoryLabel,
                        { color: selected ? palette.brand : palette.ink },
                      ]}
                    >
                      {category.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {activeGroup ? (
            <View
              style={[
                styles.productPanel,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}
            >
              <View style={styles.productPanelHeader}>
                <View style={styles.productPanelLead}>
                  <View
                    style={[
                      styles.productPanelIcon,
                      { backgroundColor: palette.brandSoft },
                    ]}
                  >
                    {serviceIcon(activeGroup.icon, palette.brand, 21)}
                  </View>
                  <View style={styles.productPanelCopy}>
                    <Text
                      style={[styles.productPanelTitle, { color: palette.ink }]}
                    >
                      {activeGroup.name}
                    </Text>
                    <Text
                      style={[styles.productPanelMeta, { color: palette.muted }]}
                    >
                      Choose a plan or company to continue
                    </Text>
                  </View>
                </View>
                <Text style={[styles.sectionCount, { color: palette.muted }]}>
                  {activeGroup.products.length}
                </Text>
              </View>

              <View style={styles.productGrid}>
                {visibleProducts.map((item) => {
                  const available = item.available === true;
                  return (
                    <Pressable
                      key={firstString(item, ["product_id"]) ?? JSON.stringify(item)}
                      disabled={!available}
                      onPress={() => chooseProduct(item)}
                      style={({ pressed }) => [
                        styles.product,
                        {
                          backgroundColor: palette.surfaceSubtle,
                          borderColor: palette.border,
                          opacity: available ? (pressed ? 0.74 : 1) : 0.48,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.productAccent,
                          {
                            backgroundColor: available
                              ? palette.brandSoft
                              : palette.soft,
                          },
                        ]}
                      >
                        {available ? (
                          <Sparkles color={palette.brand} size={16} />
                        ) : (
                          <ReceiptText color={palette.muted} size={16} />
                        )}
                      </View>
                      <View style={styles.productCopy}>
                        <Text
                          numberOfLines={2}
                          style={[styles.productTitle, { color: palette.ink }]}
                        >
                          {firstString(item, ["product_name"]) ?? "Bill payment"}
                        </Text>
                        <Text
                          style={[
                            styles.productMeta,
                            { color: available ? palette.brand : palette.muted },
                          ]}
                        >
                          {available ? "Pay now" : "Coming soon"}
                        </Text>
                      </View>
                      {available ? (
                        <ChevronRight color={palette.muted} size={17} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>

              {activeGroup.products.length > DEFAULT_PRODUCT_LIMIT ? (
                <AppButton
                  label={
                    showAllProducts
                      ? "Show fewer options"
                      : `View all ${activeGroup.products.length} options`
                  }
                  variant="secondary"
                  size="sm"
                  onPress={() => setShowAllProducts((value) => !value)}
                />
              ) : null}
            </View>
          ) : null}
        </>
      )}

      {paymentRows.length ? (
        <View
          style={[
            styles.historyPanel,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <View style={styles.sectionHeader}>
            <View>
              <Text style={[styles.sectionEyebrow, { color: palette.brand }]}>
                RECENT ACTIVITY
              </Text>
              <Text style={[styles.sectionTitle, { color: palette.ink }]}>
                Bill requests
              </Text>
            </View>
            <Text style={[styles.sectionCount, { color: palette.muted }]}>
              {paymentRows.length}
            </Text>
          </View>

          <View>
            {visiblePayments.map((item, index) => (
              <View
                key={
                  firstString(item, ["id"]) ??
                  firstString(item, ["public_reference"]) ??
                  String(index)
                }
                style={[
                  styles.historyRow,
                  index < visiblePayments.length - 1 && {
                    borderBottomColor: palette.border,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={styles.historyCopy}>
                  <Text
                    numberOfLines={1}
                    style={[styles.historyTitle, { color: palette.ink }]}
                  >
                    {firstString(item, ["public_reference"]) ?? "Bill request"}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.historyMeta, { color: palette.muted }]}
                  >
                    {firstString(item, ["customer_identifier"]) ??
                      "Customer details saved"}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusPill,
                    { backgroundColor: palette.brandSoft },
                  ]}
                >
                  <Text style={[styles.statusText, { color: palette.brand }]}>
                    {friendlyStatus(firstString(item, ["status"]) ?? "pending")}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {paymentRows.length > DEFAULT_HISTORY_LIMIT ? (
            <AppButton
              label={showAllHistory ? "Show recent only" : "View all requests"}
              variant="ghost"
              size="sm"
              onPress={() => setShowAllHistory((value) => !value)}
            />
          ) : null}
        </View>
      ) : null}

      <AppModal
        visible={Boolean(product)}
        title={firstString(product, ["product_name"]) ?? "Pay bill"}
        description="Enter the customer details and amount. You will confirm before the payment is completed."
        onClose={closePayment}
      >
        <View
          style={[
            styles.modalSummary,
            { backgroundColor: palette.surfaceSubtle, borderColor: palette.border },
          ]}
        >
          <View style={styles.modalSummaryRow}>
            <Text style={[styles.modalSummaryLabel, { color: palette.muted }]}>
              Available balance
            </Text>
            <Text style={[styles.modalSummaryValue, { color: palette.ink }]}>
              {formatMajorMoney(balance, selectedCurrency)}
            </Text>
          </View>
          {fixedAmount !== null ? (
            <View style={styles.modalSummaryRow}>
              <Text style={[styles.modalSummaryLabel, { color: palette.muted }]}>
                Amount
              </Text>
              <Text style={[styles.modalSummaryValue, { color: palette.ink }]}>
                {formatMajorMoney(fixedAmount, selectedCurrency)}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.formFields}>
          <AppField
            label={
              firstString(product, ["customer_identifier_label"]) ??
              "Account or phone number"
            }
            value={identifier}
            onChangeText={setIdentifier}
            placeholder={
              firstString(product, ["customer_identifier_hint"]) ??
              "Enter customer detail"
            }
          />

          {fixedAmount === null ? (
            <AppField
              label="Amount"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
          ) : null}

          {showOptionalFields ? (
            <>
              <AppField
                label="Recipient phone (optional)"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
              />
              <AppField
                label="Promo code (optional)"
                value={promo}
                onChangeText={setPromo}
                autoCapitalize="none"
              />
            </>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowOptionalFields(true)}
              style={({ pressed }) => [
                styles.optionalButton,
                {
                  backgroundColor: palette.surfaceSubtle,
                  borderColor: palette.border,
                  opacity: pressed ? 0.76 : 1,
                },
              ]}
            >
              <Text style={[styles.optionalText, { color: palette.brand }]}>
                Add recipient phone or promo code
              </Text>
              <ChevronRight color={palette.brand} size={16} />
            </Pressable>
          )}
        </View>

        <View style={styles.actions}>
          <View style={styles.actionSlot}>
            <AppButton
              label="Cancel"
              variant="secondary"
              fullWidth
              onPress={closePayment}
            />
          </View>
          <View style={styles.actionSlot}>
            <AppButton
              label="Continue"
              fullWidth
              loading={createPayment.isPending}
              disabled={!canSubmit}
              onPress={() => void submit()}
            />
          </View>
        </View>
      </AppModal>

      <AppModal
        visible={Boolean(notice)}
        title={createPayment.isError ? "Payment not completed" : "Request received"}
        description={notice ?? ""}
        tone={createPayment.isError ? "danger" : "success"}
        onClose={() => setNotice(null)}
      >
        <AppButton label="Done" onPress={() => setNotice(null)} />
      </AppModal>
    </Screen>
  );
}

function groupCatalog(records: readonly PlatformRecord[]): CatalogGroup[] {
  const groups = new Map<string, CatalogGroup>();

  for (const item of records) {
    const key = firstString(item, ["category_key"]) ?? "other";
    const group =
      groups.get(key) ??
      ({
        key,
        name: firstString(item, ["category_name"]) ?? "More bills",
        icon: firstString(item, ["icon_key"]) ?? "receipt",
        products: [],
      } satisfies CatalogGroup);

    group.products.push(item);
    groups.set(key, group);
  }

  return [...groups.values()];
}

function serviceIcon(key: string, color: string, size = 20) {
  const Icon =
    key === "zap"
      ? Zap
      : key === "phone"
        ? Phone
        : key === "wifi"
          ? Wifi
          : ReceiptText;
  return <Icon color={color} size={size} />;
}

function friendlyStatus(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatMajorMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

const styles = StyleSheet.create({
  walletCard: {
    minHeight: 92,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    padding: spacing.md,
  },
  walletIcon: {
    width: 48,
    height: 48,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  walletCopy: { flex: 1, minWidth: 0, gap: 2 },
  walletLabel: { ...typography.eyebrow, fontSize: 8 },
  walletValue: {
    ...typography.heading,
    fontSize: 24,
    lineHeight: 29,
    letterSpacing: -0.45,
  },
  walletHint: { ...typography.caption, fontWeight: "800" },

  offerSection: { gap: spacing.sm },
  offerStrip: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  offerCard: {
    minWidth: 148,
    flex: 1,
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.sm + 2,
  },
  offerCopy: { flex: 1, minWidth: 0, gap: 1 },
  offerValue: { fontSize: 12, fontWeight: "900" },
  offerName: { fontSize: 10, fontWeight: "800" },
  offerState: { fontSize: 10, fontWeight: "900" },

  loading: {
    minHeight: 150,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  loadingText: { ...typography.caption },

  sectionHeader: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  sectionEyebrow: { ...typography.eyebrow, fontSize: 8 },
  sectionTitle: { ...typography.sectionTitle, fontSize: 16 },
  sectionCount: { ...typography.caption, fontSize: 10, fontWeight: "800" },

  categorySection: { gap: spacing.sm },
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  categoryChip: {
    minWidth: 132,
    flexGrow: 1,
    flexBasis: 132,
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
  },
  categoryIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryLabel: {
    flex: 1,
    ...typography.bodyStrong,
    fontSize: 12,
  },

  productPanel: {
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    padding: spacing.md,
  },
  productPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  productPanelLead: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
  },
  productPanelIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  productPanelCopy: { flex: 1, minWidth: 0, gap: 1 },
  productPanelTitle: { ...typography.subheading, fontSize: 15 },
  productPanelMeta: { ...typography.caption, fontSize: 10 },

  productGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  product: {
    minWidth: 145,
    flexGrow: 1,
    flexBasis: 145,
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.sm + 2,
  },
  productAccent: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  productCopy: { flex: 1, minWidth: 0, gap: 2 },
  productTitle: { fontSize: 12, lineHeight: 16, fontWeight: "900" },
  productMeta: { fontSize: 10, fontWeight: "800" },

  historyPanel: {
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    padding: spacing.md,
  },
  historyRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  historyCopy: { flex: 1, minWidth: 0, gap: 2 },
  historyTitle: { ...typography.bodyStrong, fontSize: 12 },
  historyMeta: { ...typography.caption, fontSize: 10 },
  statusPill: {
    maxWidth: 126,
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  statusText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "900",
    textAlign: "center",
  },

  modalSummary: {
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  modalSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  modalSummaryLabel: { ...typography.caption },
  modalSummaryValue: { ...typography.bodyStrong, fontSize: 13 },
  formFields: { gap: spacing.sm + 2 },
  optionalButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  optionalText: { ...typography.caption, fontWeight: "900" },

  actions: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.sm,
  },
  actionSlot: { flex: 1, minWidth: 0 },
});
