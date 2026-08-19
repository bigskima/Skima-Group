import { router } from "expo-router";
import { Building2, CheckCircle2, ChevronRight, Plus, Search, ShieldCheck } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  firstNumber,
  firstString,
  nestedRecord,
  nestedRecords,
  recordId,
  type PlatformRecord,
} from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { AppField } from "./AppField";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { SectionHeader } from "./SectionHeader";
import { WithdrawalModal } from "./WithdrawalModal";

type Workspace = "customer" | "driver" | "station";
type BankOption = { name: string; code: string };

export function WithdrawalExperience({ workspace }: { workspace: Workspace }) {
  const { palette } = useAppTheme();
  const wallets = domainQueries.wallets();
  const beneficiaries = domainQueries.beneficiaries();
  const providers = domainQueries.providers();

  const wallet = wallets.data?.[0];
  const walletId = firstString(wallet, ["wallet_id", "walletId", "id"]);
  const available = firstNumber(wallet, ["available_balance", "availableBalance", "balance"]) ?? 0;
  const currency = firstString(wallet, ["currency_code", "currencyCode"]) ?? "NGN";

  const activeBeneficiaries = (beneficiaries.data ?? []).filter(
    (item) => firstString(item, ["status"]) === "active",
  );

  // Public display data may come from any active payment adapter, but the mobile
  // client never chooses which adapter executes a payout. The API gateway resolves
  // the configured provider on the server when providerAdapterKey is omitted.
  const bankDirectory = useMemo<BankOption[]>(() => {
    const byCode = new Map<string, BankOption>();
    for (const provider of providers.data ?? []) {
      if (
        firstString(provider, ["provider_kind", "providerKind"]) !== "payment" ||
        firstString(provider, ["status"]) !== "active"
      ) {
        continue;
      }
      const config = nestedRecord(provider, "config");
      for (const item of nestedRecords(config, "public_bank_directory")) {
        const name = firstString(item, ["name", "display_name", "displayName"]) ?? "";
        const code = firstString(item, ["code", "bank_code", "bankCode"]) ?? "";
        if (name && code && !byCode.has(code)) byCode.set(code, { name, code });
      }
    }
    return Array.from(byCode.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [providers.data]);

  const bankNameByCode = useMemo(
    () => new Map(bankDirectory.map((bank) => [bank.code, bank.name])),
    [bankDirectory],
  );

  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [adding, setAdding] = useState(activeBeneficiaries.length === 0);
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankSearch, setBankSearch] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [withdrawalResult, setWithdrawalResult] = useState<{ id?: string; reference?: string; status?: string } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const addBeneficiary = useGatewayMutation({
    path: "/runtime/withdrawal-beneficiaries",
    schema: ActionResponseSchema,
    invalidate: [["withdrawal-beneficiaries"]],
  });
  const withdraw = useGatewayMutation({
    path: "/runtime/withdrawals",
    schema: ActionResponseSchema,
    invalidate: [["withdrawals"], ["wallets"]],
  });

  const filteredBanks = useMemo(() => {
    const query = bankSearch.trim().toLowerCase();
    if (!query) return bankDirectory.slice(0, 12);
    return bankDirectory.filter(
      (bank) => bank.name.toLowerCase().includes(query) || bank.code.includes(query),
    );
  }, [bankDirectory, bankSearch]);

  const selectedBeneficiary = activeBeneficiaries.find((item) => recordId(item) === destination);
  const selectedBeneficiaryBankCode = firstString(selectedBeneficiary, ["bank_code", "bankCode"]) ?? "";
  const selectedBeneficiaryBankName = bankNameByCode.get(selectedBeneficiaryBankCode) ?? "Bank / institution";
  const selectedBeneficiaryName = firstString(selectedBeneficiary, ["account_name", "accountName"]) ?? "Payout account";
  const selectedBeneficiaryLast4 = firstString(selectedBeneficiary, ["account_number_last4", "accountNumberLast4"]) ?? "";
  const isValidNuban = /^\d{10}$/.test(accountNumber.trim());
  const canAddAccount = Boolean(walletId && bankCode && accountName.trim() && isValidNuban);

  const addAccount = async () => {
    setMessage(null);
    if (!canAddAccount || !walletId) {
      setMessage("Complete the account name, 10-digit account number, and bank selection.");
      return;
    }
    try {
      await addBeneficiary.mutateAsync({
        walletId,
        accountName: accountName.trim(),
        accountNumber: accountNumber.trim(),
        bankCode,
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey(`${workspace}-beneficiary`, walletId),
      });
      setAccountName("");
      setAccountNumber("");
      setBankCode("");
      setBankSearch("");
      setAdding(false);
      setMessage("Payout account added successfully.");
      await beneficiaries.refetch();
    } catch (cause) {
      setMessage(friendlyError(cause, "The payout account could not be added."));
    }
  };

  const openSummary = () => {
    const value = Number(amount);
    setMessage(null);
    if (!walletId || !destination || !Number.isFinite(value) || value <= 0 || value > available) {
      setMessage("Choose a payout account and enter an amount within your available balance.");
      return;
    }
    setWithdrawalResult(null);
    setModalError(null);
    setModalVisible(true);
  };

  const confirmWithdrawal = async () => {
    const value = Number(amount);
    if (!walletId || !destination || !Number.isFinite(value) || value <= 0) return;
    setModalError(null);
    try {
      const result = await withdraw.mutateAsync({
        walletId,
        beneficiaryId: destination,
        amount: value,
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey(`${workspace}-withdrawal`, walletId),
      });
      const response = typeof result === "object" && result !== null ? result : {};
      const reference = firstString(response as PlatformRecord, ["public_reference", "publicReference", "reference"]);
      const id = firstString(response as PlatformRecord, ["id"]);
      setWithdrawalResult({ id: id ?? undefined, reference: reference ?? undefined, status: "processing" });
      setAmount("");
    } catch (cause) {
      setModalError(friendlyError(cause, "The withdrawal request could not be processed."));
    }
  };

  return (
    <Screen
      eyebrow="Payouts"
      title="Withdraw funds"
      subtitle="Send available SKIMA funds to one of your verified payout accounts."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
        <View style={styles.heroHead}>
          <View>
            <Text style={styles.heroLabel}>AVAILABLE TO WITHDRAW</Text>
            <Text adjustsFontSizeToFit numberOfLines={1} style={styles.heroAmount}>{money(available, currency)}</Text>
          </View>
          <View style={styles.heroShield}>
            <ShieldCheck color="#FFFFFF" size={23} />
          </View>
        </View>
        <Text style={styles.heroBody}>Your request is checked against the active SKIMA payout policy before processing.</Text>
      </View>

      {adding ? (
        <Card padding="lg">
          <SectionHeader title="Add payout account" description="Account details are stored as protected payout credentials after verification." />
          <AppField label="Account holder name" value={accountName} onChangeText={setAccountName} placeholder="Full account name" autoCapitalize="words" />
          <AppField label="Account number" value={accountNumber} onChangeText={setAccountNumber} placeholder="10-digit NUBAN" keyboardType="number-pad" maxLength={10} error={accountNumber.length > 0 && !isValidNuban ? "Enter a valid 10-digit NUBAN account number." : null} />

          {bankDirectory.length ? (
            <View style={styles.bankSection}>
              <Text style={[styles.fieldLabel, { color: palette.ink }]}>Bank or financial institution</Text>
              <View style={[styles.searchShell, { backgroundColor: palette.input, borderColor: palette.borderStrong }]}>
                <Search color={palette.muted} size={17} />
                <TextInput
                  value={bankSearch}
                  onChangeText={setBankSearch}
                  placeholder="Search bank name or code"
                  placeholderTextColor={palette.muted}
                  style={[styles.searchInput, { color: palette.ink }]}
                />
              </View>
              <View style={styles.bankGrid}>
                {filteredBanks.map((bank) => {
                  const selected = bank.code === bankCode;
                  return (
                    <Pressable
                      key={bank.code}
                      accessibilityRole="button"
                      onPress={() => setBankCode(bank.code)}
                      style={({ pressed }) => [
                        styles.bankOption,
                        {
                          backgroundColor: selected ? palette.brandSoft : palette.surfaceSubtle,
                          borderColor: selected ? palette.brand : palette.border,
                          opacity: pressed ? 0.72 : 1,
                        },
                      ]}
                    >
                      <Building2 color={selected ? palette.brand : palette.mutedStrong} size={17} />
                      <View style={styles.bankOptionCopy}>
                        <Text numberOfLines={1} style={[styles.bankName, { color: palette.ink }]}>{bank.name}</Text>
                        <Text style={[styles.bankCode, { color: palette.muted }]}>Code {bank.code}</Text>
                      </View>
                      {selected ? <CheckCircle2 color={palette.brand} size={17} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : (
            <View style={[styles.configurationNotice, { backgroundColor: palette.warningSoft }]}>
              <Text style={[styles.configurationText, { color: palette.ink }]}>Adding a new payout account is temporarily unavailable because no public bank directory is configured. Existing verified payout accounts can still be used.</Text>
            </View>
          )}

          <AppButton label="Add payout account" fullWidth loading={addBeneficiary.isPending} disabled={!canAddAccount} onPress={() => void addAccount()} />
          {activeBeneficiaries.length ? <AppButton label="Use an existing account" variant="ghost" fullWidth onPress={() => setAdding(false)} /> : null}
        </Card>
      ) : (
        <>
          <SectionHeader title="Payout account" description="Choose where this withdrawal should be sent." action={<AppButton label="Add new" variant="ghost" size="sm" icon={<Plus color={palette.brand} size={15} />} onPress={() => setAdding(true)} />} />
          <View style={styles.beneficiaryList}>
            {activeBeneficiaries.length ? activeBeneficiaries.map((beneficiary) => {
              const id = recordId(beneficiary) ?? "";
              const selected = destination === id;
              const code = firstString(beneficiary, ["bank_code", "bankCode"]) ?? "";
              const name = firstString(beneficiary, ["account_name", "accountName"]) ?? "Payout account";
              const last4 = firstString(beneficiary, ["account_number_last4", "accountNumberLast4"]) ?? "";
              const bankName = bankNameByCode.get(code) ?? `Bank code ${code || "—"}`;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  onPress={() => setDestination(id)}
                  style={({ pressed }) => [
                    styles.beneficiary,
                    shadows.soft,
                    {
                      backgroundColor: selected ? palette.brandSofter : palette.surface,
                      borderColor: selected ? palette.brand : palette.border,
                      opacity: pressed ? 0.74 : 1,
                    },
                  ]}
                >
                  <View style={[styles.beneficiaryIcon, { backgroundColor: selected ? palette.brandSoft : palette.soft }]}>
                    <Building2 color={selected ? palette.brand : palette.mutedStrong} size={20} />
                  </View>
                  <View style={styles.beneficiaryCopy}>
                    <Text style={[styles.beneficiaryName, { color: palette.ink }]}>{name}</Text>
                    <Text style={[styles.beneficiaryMeta, { color: palette.muted }]}>{bankName}{last4 ? ` · •••• ${last4}` : ""}</Text>
                  </View>
                  {selected ? <CheckCircle2 color={palette.brand} size={20} /> : <ChevronRight color={palette.muted} size={18} />}
                </Pressable>
              );
            }) : (
              <EmptyState
                icon={<Building2 color={palette.brand} size={26} />}
                title="No payout account yet"
                description="Add a verified bank account before requesting your first withdrawal."
                action={<AppButton label="Add payout account" onPress={() => setAdding(true)} />}
              />
            )}
          </View>

          {activeBeneficiaries.length ? (
            <Card padding="lg">
              <AppField
                label={`Amount (${currency})`}
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                keyboardType="decimal-pad"
                hint={`Available balance: ${money(available, currency)}`}
              />
              <AppButton label="Review withdrawal" fullWidth disabled={!destination || !amount.trim()} onPress={openSummary} />
            </Card>
          ) : null}
        </>
      )}

      {message ? (
        <View style={[styles.message, { backgroundColor: /success/i.test(message) ? palette.successSoft : palette.dangerSoft }]}>
          <Text style={[styles.messageText, { color: /success/i.test(message) ? palette.success : palette.danger }]}>{message}</Text>
        </View>
      ) : null}

      <WithdrawalModal
        visible={modalVisible}
        amount={Number(amount) || 0}
        currency={currency}
        accountName={selectedBeneficiaryName}
        accountNumber={selectedBeneficiaryLast4}
        bankName={selectedBeneficiaryBankName}
        isSubmitting={withdraw.isPending}
        submittedResult={withdrawalResult}
        error={modalError}
        onConfirm={() => void confirmWithdrawal()}
        onClose={() => {
          setModalVisible(false);
          if (withdrawalResult) router.back();
        }}
      />
    </Screen>
  );
}

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

const styles = StyleSheet.create({
  hero: { padding: spacing.lg, borderRadius: radii.xl, gap: spacing.md },
  heroHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  heroLabel: { color: "rgba(255,255,255,.78)", ...typography.eyebrow, fontSize: 9 },
  heroAmount: { color: "#FFFFFF", fontSize: 36, lineHeight: 43, fontWeight: "900", letterSpacing: -1, marginTop: 5 },
  heroShield: { width: 46, height: 46, borderRadius: 16, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  heroBody: { color: "rgba(255,255,255,.82)", ...typography.caption, maxWidth: 450, lineHeight: 18 },
  bankSection: { gap: spacing.sm },
  fieldLabel: { ...typography.caption, fontSize: 13, fontWeight: "800" },
  searchShell: { minHeight: 48, borderRadius: radii.md, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, ...typography.body, paddingVertical: 0 },
  bankGrid: { gap: spacing.xs },
  bankOption: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth },
  bankOptionCopy: { flex: 1, minWidth: 0 },
  bankName: { ...typography.caption, fontSize: 12, fontWeight: "800" },
  bankCode: { ...typography.caption, fontSize: 10, marginTop: 2 },
  configurationNotice: { borderRadius: radii.md, padding: spacing.md },
  configurationText: { ...typography.caption, lineHeight: 18 },
  beneficiaryList: { gap: spacing.sm },
  beneficiary: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth },
  beneficiaryIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  beneficiaryCopy: { flex: 1, minWidth: 0 },
  beneficiaryName: { ...typography.bodyStrong, fontSize: 14 },
  beneficiaryMeta: { ...typography.caption, marginTop: 3 },
  message: { padding: spacing.md, borderRadius: radii.md },
  messageText: { ...typography.caption, fontWeight: "800", textAlign: "center" },
});
