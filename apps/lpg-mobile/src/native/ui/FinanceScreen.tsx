import { router } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  displayReference,
  displayStatus,
  firstNumber,
  firstString,
  recordId,
} from "../api/records";
import { colors, radii, spacing } from "../theme/tokens";
import { idempotencyKey } from "../utilities/idempotency";
import { Card } from "./Card";
import { Screen } from "./Screen";

export function FinanceScreen({
  workspace,
}: {
  workspace: "driver" | "station";
}) {
  const wallets = domainQueries.wallets();
  const entries =
    workspace === "driver"
      ? domainQueries.commissions()
      : domainQueries.settlements();
  const withdrawals = domainQueries.withdrawals();
  const wallet = wallets.data?.[0];
  const currency =
    firstString(wallet, ["currency_code", "currencyCode"]) ?? "NGN";
  const available =
    firstNumber(wallet, ["available_balance", "availableBalance", "balance"]) ??
    0;
  return (
    <Screen
      eyebrow="Verified finance"
      title={workspace === "driver" ? "Earnings" : "Settlements"}
      action={
        <Pressable
          style={styles.action}
          onPress={() =>
            router.push(
              `/${workspace === "driver" ? "(driver)" : "(station)"}/withdraw` as never,
            )
          }
        >
          <Text style={styles.actionText}>Withdraw</Text>
        </Pressable>
      }
    >
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>AVAILABLE BALANCE</Text>
        <Text style={styles.heroAmount}>{money(available, currency)}</Text>
        <Text style={styles.heroBody}>
          Backend-confirmed funds available for a verified payout destination.
        </Text>
      </View>
      {entries.isPending || wallets.isPending ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <View style={styles.grid}>
          <Metric
            label={workspace === "driver" ? "Commission entries" : "Statements"}
            value={String(entries.data?.length ?? 0)}
          />
          <Metric
            label="Withdrawal requests"
            value={String(withdrawals.data?.length ?? 0)}
          />
        </View>
      )}
      <Text style={styles.section}>Recent activity</Text>
      {(entries.data ?? []).slice(0, 10).map((item, index) => (
        <Card key={recordId(item) ?? String(index)}>
          <View style={styles.row}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.itemTitle}>
                {displayReference(item) ??
                  (workspace === "driver" ? "Commission" : "Settlement")}
              </Text>
              <Text style={styles.itemMeta}>
                {(displayStatus(item) ?? "recorded").replace(/[_-]/g, " ")}
              </Text>
            </View>
            <Text style={styles.amount}>
              {money(
                firstNumber(item, [
                  "net_amount",
                  "netAmount",
                  "amount",
                  "commission_amount",
                  "commissionAmount",
                ]) ?? 0,
                firstString(item, ["currency_code", "currencyCode"]) ??
                  currency,
              )}
            </Text>
          </View>
        </Card>
      ))}
      {(entries.data ?? []).length === 0 && !entries.isPending ? (
        <Text style={styles.empty}>
          Backend-confirmed finance entries will appear here.
        </Text>
      ) : null}
    </Screen>
  );
}

export function WithdrawalScreen({
  workspace,
}: {
  workspace: "driver" | "station";
}) {
  const wallets = domainQueries.wallets();
  const beneficiaries = domainQueries.beneficiaries();
  const providers = domainQueries.providers();
  const wallet = wallets.data?.[0];
  const walletId = firstString(wallet, ["wallet_id", "walletId", "id"]);
  const available =
    firstNumber(wallet, ["available_balance", "availableBalance", "balance"]) ??
    0;
  const currency =
    firstString(wallet, ["currency_code", "currencyCode"]) ?? "NGN";
  const active = (beneficiaries.data ?? []).filter(
    (item) => firstString(item, ["status"]) === "active",
  );
  const paymentProviders = useMemo(
    () =>
      (providers.data ?? []).filter(
        (item) =>
          firstString(item, ["provider_kind", "providerKind"]) === "payment" &&
          firstString(item, ["status"]) === "active",
      ),
    [providers.data],
  );
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [adding, setAdding] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [provider, setProvider] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const add = useGatewayMutation({
    path: "/runtime/withdrawal-beneficiaries",
    schema: ActionResponseSchema,
    invalidate: [["withdrawal-beneficiaries"]],
  });
  const withdraw = useGatewayMutation({
    path: "/runtime/withdrawals",
    schema: ActionResponseSchema,
    invalidate: [["withdrawals"], ["wallets"]],
  });
  const addAccount = async () => {
    setMessage(null);
    if (
      !walletId ||
      !accountName.trim() ||
      !accountNumber.trim() ||
      !provider
    ) {
      setMessage("Complete the verified payout account details.");
      return;
    }
    try {
      await add.mutateAsync({
        walletId,
        accountName: accountName.trim(),
        accountNumber: accountNumber.trim(),
        bankCode: bankCode.trim() || undefined,
        providerAdapterKey: provider,
        idempotencyKey: idempotencyKey(`${workspace}-beneficiary`, walletId),
      });
      setAdding(false);
      setMessage("Payout account submitted for provider verification.");
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Account could not be added.",
      );
    }
  };
  const request = async () => {
    const value = Number(amount);
    setMessage(null);
    if (
      !walletId ||
      !destination ||
      !Number.isFinite(value) ||
      value <= 0 ||
      value > available
    ) {
      setMessage(
        "Choose a verified account and enter an amount within your available balance.",
      );
      return;
    }
    try {
      await withdraw.mutateAsync({
        walletId,
        beneficiaryId: destination,
        amount: value,
        idempotencyKey: idempotencyKey(`${workspace}-withdrawal`, walletId),
      });
      setAmount("");
      setMessage("Withdrawal request submitted securely.");
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Withdrawal could not be submitted.",
      );
    }
  };
  return (
    <Screen
      eyebrow="Payout workflow"
      title="Withdraw funds"
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
      }
    >
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>AVAILABLE</Text>
        <Text style={styles.heroAmount}>{money(available, currency)}</Text>
      </View>
      {adding || active.length === 0 ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="Account name"
            placeholderTextColor={colors.muted}
            value={accountName}
            onChangeText={setAccountName}
          />
          <TextInput
            style={styles.input}
            placeholder="Account number"
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            value={accountNumber}
            onChangeText={setAccountNumber}
          />
          <TextInput
            style={styles.input}
            placeholder="Bank code (optional)"
            placeholderTextColor={colors.muted}
            value={bankCode}
            onChangeText={setBankCode}
          />
          <View style={styles.options}>
            {paymentProviders.map((item) => {
              const key = firstString(item, ["key"]) ?? "";
              return (
                <Pressable
                  key={key}
                  onPress={() => setProvider(key)}
                  style={[styles.option, provider === key && styles.selected]}
                >
                  <Text style={styles.optionText}>
                    {firstString(item, ["display_name", "displayName"]) ?? key}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            style={styles.primary}
            disabled={add.isPending}
            onPress={() => void addAccount()}
          >
            {add.isPending ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.primaryText}>Add payout account</Text>
            )}
          </Pressable>
        </>
      ) : (
        <>
          <View style={styles.options}>
            {active.map((item) => {
              const id = recordId(item) ?? "";
              return (
                <Pressable
                  key={id}
                  onPress={() => setDestination(id)}
                  style={[styles.option, destination === id && styles.selected]}
                >
                  <Text style={styles.optionText}>
                    {firstString(item, ["account_name", "accountName"]) ??
                      "Bank account"}{" "}
                    ••••{" "}
                    {firstString(item, [
                      "account_number_last4",
                      "accountNumberLast4",
                    ]) ?? ""}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            style={styles.input}
            placeholder={`Amount (${currency})`}
            placeholderTextColor={colors.muted}
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
          />
          <Pressable
            style={styles.primary}
            disabled={withdraw.isPending}
            onPress={() => void request()}
          >
            {withdraw.isPending ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.primaryText}>Request withdrawal</Text>
            )}
          </Pressable>
          <Pressable onPress={() => setAdding(true)}>
            <Text style={styles.back}>Add another payout account</Text>
          </Pressable>
        </>
      )}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <Text style={styles.note}>
        Funds are reserved and transferred by the configured provider adapter
        after backend verification.
      </Text>
    </Screen>
  );
}
function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.itemMeta}>{label}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  action: {
    backgroundColor: "white",
    borderRadius: radii.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  actionText: { color: colors.brand, fontWeight: "900" },
  back: { color: colors.brand, fontWeight: "800" },
  hero: {
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: colors.brand,
  },
  heroLabel: { color: "#FFDDE1", fontSize: 11, fontWeight: "900" },
  heroAmount: { color: "white", fontSize: 36, fontWeight: "900" },
  heroBody: { color: "#FFF1F2" },
  grid: { flexDirection: "row", gap: spacing.md },
  metric: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
  },
  metricValue: { color: colors.ink, fontSize: 25, fontWeight: "900" },
  section: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "900",
    marginTop: spacing.sm,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  itemTitle: { color: colors.ink, fontWeight: "800" },
  itemMeta: { color: colors.muted, textTransform: "capitalize" },
  amount: { color: colors.ink, fontWeight: "900" },
  empty: { color: colors.muted, textAlign: "center", padding: spacing.xl },
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
  options: { gap: spacing.sm },
  option: {
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  selected: { borderColor: colors.brand, backgroundColor: "#FFF0F1" },
  optionText: { color: colors.ink, fontWeight: "800" },
  primary: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  primaryText: { color: "white", fontWeight: "900" },
  message: { color: colors.brandDark, fontWeight: "700" },
  note: { color: colors.muted, lineHeight: 20 },
});
