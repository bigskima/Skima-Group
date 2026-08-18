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
import { friendlyError } from "../utilities/friendlyError";
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
      eyebrow="Your money"
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
          Ready to withdraw to one of your approved payout accounts.
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
          Your completed earnings and settlements will appear here.
        </Text>
      ) : null}
    </Screen>
  );
}

import { CheckCircle2 } from "lucide-react-native";
import { WithdrawalModal } from "./WithdrawalModal";

const ALL_NIGERIAN_BANKS = [
  { name: "GTBank (Guaranty Trust)", code: "058" },
  { name: "Access Bank", code: "044" },
  { name: "Zenith Bank", code: "057" },
  { name: "First Bank of Nigeria", code: "011" },
  { name: "United Bank for Africa (UBA)", code: "033" },
  { name: "OPay Digital Services", code: "999992" },
  { name: "PalmPay", code: "999991" },
  { name: "Kuda Microfinance Bank", code: "50211" },
  { name: "Moniepoint Microfinance Bank", code: "50515" },
  { name: "Wema Bank / ALAT", code: "035" },
  { name: "Stanbic IBTC Bank", code: "221" },
  { name: "FCMB (First City Monument)", code: "214" },
  { name: "Sterling Bank", code: "232" },
  { name: "Polaris Bank", code: "076" },
  { name: "Union Bank of Nigeria", code: "032" },
  { name: "Fidelity Bank", code: "070" },
  { name: "Providus Bank", code: "101" },
  { name: "VFD Microfinance Bank", code: "566" },
  { name: "Jaiz Bank", code: "301" },
  { name: "Taj Bank", code: "302" },
  { name: "Lotus Bank", code: "303" },
  { name: "Keystone Bank", code: "082" },
  { name: "SunTrust Bank", code: "100" },
  { name: "Globus Bank", code: "103" },
  { name: "Titan Trust Bank", code: "102" },
  { name: "Parallex Bank", code: "526" },
  { name: "PremiumTrust Bank", code: "105" },
  { name: "Signature Bank", code: "106" },
  { name: "Ecobank Nigeria", code: "050" },
  { name: "Standard Chartered", code: "068" },
];

export function WithdrawalScreen({
  workspace,
}: {
  workspace: "driver" | "station" | "customer";
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
  const [bankCode, setBankCode] = useState("058");
  const [bankSearch, setBankSearch] = useState("");
  const [provider, setProvider] = useState("provider.payment.paystack");
  const [message, setMessage] = useState<string | null>(null);

  // Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [withdrawalResult, setWithdrawalResult] = useState<{ id?: string; reference?: string; status?: string } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const selectedProvider = provider || (paymentProviders.length > 0 ? (firstString(paymentProviders[0], ["key"]) ?? "provider.payment.paystack") : "provider.payment.paystack");

  const filteredBanks = useMemo(() => {
    if (!bankSearch.trim()) return ALL_NIGERIAN_BANKS.slice(0, 10);
    const q = bankSearch.toLowerCase().trim();
    return ALL_NIGERIAN_BANKS.filter(
      (b) => b.name.toLowerCase().includes(q) || b.code.includes(q),
    );
  }, [bankSearch]);

  const selectedBankObj = useMemo(
    () => ALL_NIGERIAN_BANKS.find((b) => b.code === bankCode) ?? { name: "Bank (" + bankCode + ")", code: bankCode },
    [bankCode],
  );

  const selectedBeneficiaryObj = useMemo(() => {
    return active.find((item) => (recordId(item) ?? "") === destination);
  }, [active, destination]);

  const isValidNuban = accountNumber.trim().length === 10 && /^\d+$/.test(accountNumber.trim());

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
    if (!walletId || !accountName.trim() || !accountNumber.trim()) {
      setMessage("Complete the verified payout account details.");
      return;
    }
    if (!isValidNuban) {
      setMessage("Please enter a valid 10-digit NUBAN account number.");
      return;
    }
    try {
      await add.mutateAsync({
        walletId,
        accountName: accountName.trim(),
        accountNumber: accountNumber.trim(),
        bankCode: bankCode.trim() || "058",
        providerAdapterKey: selectedProvider,
        idempotencyKey: idempotencyKey(`${workspace}-beneficiary`, walletId ?? "wallet"),
      });
      setAdding(false);
      setMessage("Payout account verified & added for Paystack transfers.");
    } catch (cause) {
      setMessage(
        friendlyError(cause, "The payout account could not be added."),
      );
    }
  };

  const openWithdrawalSummaryModal = () => {
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
    setModalError(null);
    setWithdrawalResult(null);
    setModalVisible(true);
  };

  const confirmWithdrawalSubmission = async () => {
    const value = Number(amount);
    setModalError(null);
    try {
      const res = await withdraw.mutateAsync({
        walletId,
        beneficiaryId: destination,
        amount: value,
        idempotencyKey: idempotencyKey(`${workspace}-withdrawal`, walletId ?? "wallet"),
      });

      const resObj = typeof res === "object" && res !== null ? res : {};
      const refId = firstString(resObj, ["id", "public_reference", "publicReference", "reference"]) ?? "PAYSTACK-TRF";

      setWithdrawalResult({ id: refId, reference: refId, status: "processing" });
      setAmount("");
    } catch (cause) {
      setModalError(
        friendlyError(cause, "The withdrawal request could not be processed. Please try again."),
      );
    }
  };

  return (
    <Screen
      eyebrow="Payouts"
      title="Withdraw funds"
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
      }
    >
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>AVAILABLE BALANCE</Text>
        <Text style={styles.heroAmount}>{money(available, currency)}</Text>
      </View>

      {adding || active.length === 0 ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="Account holder full name (e.g. John Doe)"
            placeholderTextColor={colors.muted}
            value={accountName}
            onChangeText={setAccountName}
          />
          
          <TextInput
            style={styles.input}
            placeholder="10-digit NUBAN account number"
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            maxLength={10}
            value={accountNumber}
            onChangeText={setAccountNumber}
          />

          {isValidNuban ? (
            <View style={styles.validNubanBadge}>
              <CheckCircle2 color={colors.success} size={16} />
              <Text style={styles.validNubanText}>10-Digit NUBAN Account Validated</Text>
            </View>
          ) : null}

          <Text style={{ color: colors.ink, fontWeight: "900", marginTop: 4 }}>
            Select Bank or Financial Institution (30+ Directory)
          </Text>

          <TextInput
            style={[styles.input, { minHeight: 46, fontSize: 14 }]}
            placeholder="🔍 Search bank name or CBN code..."
            placeholderTextColor={colors.muted}
            value={bankSearch}
            onChangeText={setBankSearch}
          />

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, maxHeight: 180 }}>
            {filteredBanks.map((b) => (
              <Pressable
                key={b.code}
                onPress={() => {
                  setBankCode(b.code);
                }}
                style={[
                  styles.option,
                  { paddingHorizontal: 12, paddingVertical: 8 },
                  bankCode === b.code && styles.selected,
                ]}
              >
                <Text style={styles.optionText}>
                  {b.name} ({b.code})
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            style={styles.primary}
            disabled={add.isPending}
            onPress={() => void addAccount()}
          >
            {add.isPending ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.primaryText}>Add & Verify Payout Account</Text>
            )}
          </Pressable>

          {active.length > 0 ? (
            <Pressable onPress={() => setAdding(false)}>
              <Text style={[styles.back, { textAlign: "center", marginTop: 8 }]}>
                Use existing payout account
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <>
          <Text style={{ color: colors.ink, fontWeight: "900" }}>Select Payout Account</Text>
          <View style={styles.options}>
            {active.map((item) => {
              const id = recordId(item) ?? "";
              const accName = firstString(item, ["account_name", "accountName"]) ?? "Bank Account";
              const accNum = firstString(item, ["account_number_last4", "accountNumberLast4"]) ?? "";
              const isSel = destination === id;
              return (
                <Pressable
                  key={id}
                  onPress={() => setDestination(id)}
                  style={[styles.option, isSel && styles.selected]}
                >
                  <Text style={styles.optionText}>
                    {accName} · •••• {accNum}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            style={styles.input}
            placeholder={`Enter amount to withdraw (${currency})`}
            placeholderTextColor={colors.muted}
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
          />

          <Pressable
            style={styles.primary}
            disabled={withdraw.isPending}
            onPress={() => openWithdrawalSummaryModal()}
          >
            <Text style={styles.primaryText}>Request Paystack Withdrawal</Text>
          </Pressable>

          <Pressable onPress={() => setAdding(true)}>
            <Text style={styles.back}>Add another payout account</Text>
          </Pressable>
        </>
      )}

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <Text style={styles.note}>
        Paystack processes your payout directly to your verified bank account via automated NIP transfer.
      </Text>

      {/* Withdrawal Confirmation & Receipt Modal */}
      <WithdrawalModal
        visible={modalVisible}
        amount={Number(amount)}
        currency={currency}
        accountName={
          firstString(selectedBeneficiaryObj, ["account_name", "accountName"]) ??
          accountName ??
          "Bank Account"
        }
        accountNumber={
          firstString(selectedBeneficiaryObj, ["account_number_last4", "accountNumberLast4"]) ??
          accountNumber
        }
        bankName={selectedBankObj.name}
        isSubmitting={withdraw.isPending}
        submittedResult={withdrawalResult}
        error={modalError}
        onConfirm={() => void confirmWithdrawalSubmission()}
        onClose={() => setModalVisible(false)}
      />
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
  validNubanBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: "#E9F7EE",
    alignSelf: "flex-start",
  },
  validNubanText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: "900",
  },
});
