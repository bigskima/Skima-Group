import { router } from "expo-router";
import { Building2, CheckCircle2, ChevronRight, Plus, Search, ShieldCheck } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { domainQueries } from "../api/domains";
import { useFinanceMutation, useFinanceQuery } from "../api/finance";
import {
  firstNumber,
  firstString,
  nestedRecords,
  recordId,
  RecordArraySchema,
  RecordObjectSchema,
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

export function FinanceWithdrawalExperience({ workspace }: { workspace: Workspace }) {
  const { palette } = useAppTheme();
  const wallets = domainQueries.wallets();
  const bankQuery = useFinanceQuery({ key: ["banks"], path: "/banks", schema: RecordObjectSchema });
  const beneficiaryQuery = useFinanceQuery({ key: ["beneficiaries"], path: "/beneficiaries", schema: RecordArraySchema });

  const wallet = useMemo(() => selectWallet(wallets.data ?? [], workspace), [wallets.data, workspace]);
  const walletId = firstString(wallet, ["wallet_id", "walletId", "id"]);
  const available = firstNumber(wallet, ["available_balance", "availableBalance", "balance"]) ?? 0;
  const currency = firstString(wallet, ["currency_code", "currencyCode"]) ?? "NGN";

  const bankDirectory = useMemo<BankOption[]>(() => {
    const options = nestedRecords(bankQuery.data, "banks")
      .map((bank) => ({
        name: firstString(bank, ["name", "display_name", "displayName"]) ?? "",
        code: firstString(bank, ["code", "bank_code", "bankCode"]) ?? "",
      }))
      .filter((bank) => bank.name && bank.code);
    return options.sort((a, b) => a.name.localeCompare(b.name));
  }, [bankQuery.data]);

  const bankNameByCode = useMemo(
    () => new Map(bankDirectory.map((bank) => [bank.code, bank.name])),
    [bankDirectory],
  );

  const beneficiaries = useMemo(
    () =>
      (beneficiaryQuery.data ?? []).filter(
        (item) =>
          firstString(item, ["wallet_id", "walletId"]) === walletId &&
          firstString(item, ["status"]) === "verified",
      ),
    [beneficiaryQuery.data, walletId],
  );

  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [adding, setAdding] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankSearch, setBankSearch] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [feePreview, setFeePreview] = useState<PlatformRecord | null>(null);
  const [withdrawalResult, setWithdrawalResult] = useState<{ id?: string; reference?: string; status?: string } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const addBeneficiary = useFinanceMutation({
    path: "/beneficiaries",
    schema: RecordObjectSchema,
    invalidate: [["withdrawal-beneficiaries"], ["wallets"]],
  });
  const preview = useFinanceMutation({
    path: "/withdrawals/preview",
    schema: RecordObjectSchema,
  });
  const withdraw = useFinanceMutation({
    path: "/withdrawals",
    schema: RecordObjectSchema,
    invalidate: [["withdrawals"], ["wallets"]],
  });

  const filteredBanks = useMemo(() => {
    const query = bankSearch.trim().toLowerCase();
    if (!query) return bankDirectory.slice(0, 14);
    return bankDirectory.filter(
      (bank) => bank.name.toLowerCase().includes(query) || bank.code.includes(query),
    );
  }, [bankDirectory, bankSearch]);

  const selectedBeneficiary = beneficiaries.find((item) => recordId(item) === destination);
  const selectedBeneficiaryBankCode = firstString(selectedBeneficiary, ["bank_code", "bankCode"]) ?? "";
  const selectedBeneficiaryBankName = bankNameByCode.get(selectedBeneficiaryBankCode) ?? "Bank / institution";
  const selectedBeneficiaryName = firstString(selectedBeneficiary, ["account_name", "accountName"]) ?? "Payout account";
  const selectedBeneficiaryLast4 = firstString(selectedBeneficiary, ["account_number_last4", "accountNumberLast4"]) ?? "";
  const isValidNuban = /^\d{10}$/.test(accountNumber.trim());
  const canAddAccount = Boolean(walletId && bankCode && accountName.trim() && isValidNuban);

  const requestedAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  const feeAmount = firstNumber(feePreview, ["calculatedFeeAmount", "calculated_fee_amount"]) ?? 0;
  const totalDebit = firstNumber(feePreview, ["totalDebitAmount", "total_debit_amount"]) ?? requestedAmount + feeAmount;

  const addAccount = async () => {
    setMessage(null);
    if (!canAddAccount || !walletId) {
      setMessage("Complete the account name, 10-digit account number, and bank selection.");
      return;
    }
    try {
      const created = await addBeneficiary.mutateAsync({
        walletId,
        accountName: accountName.trim(),
        accountNumber: accountNumber.trim(),
        bankCode,
        idempotencyKey: idempotencyKey(`${workspace}-beneficiary`, walletId),
      });
      setAccountName("");
      setAccountNumber("");
      setBankCode("");
      setBankSearch("");
      setAdding(false);
      setMessage("Payout account verified successfully.");
      const createdId = firstString(created, ["id"]);
      if (createdId) setDestination(createdId);
      await beneficiaryQuery.refetch();
    } catch (cause) {
      setMessage(friendlyError(cause, "The payout account could not be verified."));
    }
  };

  const openSummary = async () => {
    const value = Number(amount);
    setMessage(null);
    setModalError(null);
    setWithdrawalResult(null);
    if (!walletId || !destination || !Number.isFinite(value) || value <= 0) {
      setMessage("Choose a payout account and enter a valid withdrawal amount.");
      return;
    }
    if (value > available) {
      setMessage("The withdrawal amount is higher than your available balance.");
      return;
    }
    try {
      const result = await preview.mutateAsync({ walletId, amount: value });
      const fee = firstNumber(result, ["calculatedFeeAmount", "calculated_fee_amount"]) ?? 0;
      const total = firstNumber(result, ["totalDebitAmount", "total_debit_amount"]) ?? value + fee;
      if (total > available) {
        setMessage(`Your balance must cover both the withdrawal and SKIMA fee. Total required: ${money(total, currency)}.`);
        return;
      }
      setFeePreview(result);
      setModalVisible(true);
    } catch (cause) {
      setMessage(friendlyError(cause, "The withdrawal fee could not be calculated."));
    }
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
        idempotencyKey: idempotencyKey(`${workspace}-withdrawal`, walletId),
      });
      const reference = firstString(result, ["public_reference", "publicReference", "reference"]);
      const id = firstString(result, ["id"]);
      const status = firstString(result, ["status"]) ?? "processing";
      setWithdrawalResult({ id: id ?? undefined, reference: reference ?? undefined, status });
    } catch (cause) {
      setModalError(friendlyError(cause, "The withdrawal could not be processed."));
    }
  };

  return (
    <Screen
      eyebrow="Payouts"
      title="Withdraw funds"
      subtitle="Choose a verified payout account. SKIMA shows the exact fee and wallet debit before you confirm."
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
        <Text style={styles.heroBody}>The amount you request is the amount sent to your bank. Any SKIMA fee is shown separately and is not added to the transfer amount.</Text>
      </View>

      {!walletId && !wallets.isLoading ? (
        <EmptyState
          icon={<ShieldCheck color={palette.brand} size={26} />}
          title="No payout wallet available"
          description="Withdrawals are not available for this account yet."
        />
      ) : adding ? (
        <Card padding="lg">
          <SectionHeader title="Add payout account" description="We will confirm your bank details before you can receive funds." />
          <AppField label="Account holder name" value={accountName} onChangeText={setAccountName} placeholder="Full account name" autoCapitalize="words" />
          <AppField label="Account number" value={accountNumber} onChangeText={setAccountNumber} placeholder="10-digit NUBAN" keyboardType="number-pad" maxLength={10} error={accountNumber.length > 0 && !isValidNuban ? "Enter a valid 10-digit account number." : null} />

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
                        <Text style={[styles.bankCodeText, { color: palette.muted }]}>Code {bank.code}</Text>
                      </View>
                      {selected ? <CheckCircle2 color={palette.brand} size={17} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : (
            <View style={[styles.configurationNotice, { backgroundColor: palette.warningSoft }]}>
              <Text style={[styles.configurationText, { color: palette.ink }]}>The payout bank directory is temporarily unavailable. Existing verified accounts remain usable.</Text>
            </View>
          )}

          <AppButton label="Verify payout account" fullWidth loading={addBeneficiary.isPending} disabled={!canAddAccount} onPress={() => void addAccount()} />
          {beneficiaries.length ? <AppButton label="Use an existing account" variant="ghost" fullWidth onPress={() => setAdding(false)} /> : null}
        </Card>
      ) : (
        <>
          <SectionHeader
            title="Payout account"
            description="Only verified accounts for this wallet can receive a withdrawal."
            action={<AppButton label="Add new" variant="ghost" size="sm" icon={<Plus color={palette.brand} size={15} />} onPress={() => setAdding(true)} />}
          />
          <View style={styles.beneficiaryList}>
            {beneficiaries.length ? beneficiaries.map((beneficiary) => {
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
                title="No verified payout account"
                description="Add and verify a bank account before requesting a withdrawal."
                action={<AppButton label="Add payout account" onPress={() => setAdding(true)} />}
              />
            )}
          </View>

          {beneficiaries.length ? (
            <Card padding="lg">
              <AppField
                label={`Amount sent to bank (${currency})`}
                value={amount}
                onChangeText={(value) => { setAmount(value); setFeePreview(null); setMessage(null); }}
                placeholder="0.00"
                keyboardType="decimal-pad"
                hint={`Available balance: ${money(available, currency)}`}
              />
              <AppButton label="Review withdrawal" fullWidth loading={preview.isPending} disabled={!destination || !amount.trim()} onPress={() => void openSummary()} />
            </Card>
          ) : null}
        </>
      )}

      {message ? (
        <View style={[styles.message, { backgroundColor: /success|verified/i.test(message) ? palette.successSoft : palette.dangerSoft }]}>
          <Text style={[styles.messageText, { color: /success|verified/i.test(message) ? palette.success : palette.danger }]}>{message}</Text>
        </View>
      ) : null}

      <WithdrawalModal
        visible={modalVisible}
        amount={requestedAmount}
        feeAmount={feeAmount}
        totalDebitAmount={totalDebit}
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
          if (withdrawalResult) {
            setAmount("");
            setFeePreview(null);
            void wallets.refetch();
            router.back();
          }
        }}
      />
    </Screen>
  );
}

function selectWallet(walletList: readonly PlatformRecord[], workspace: Workspace): PlatformRecord | null {
  const active = walletList.filter((wallet) => firstString(wallet, ["wallet_status", "status"]) !== "closed");
  if (workspace === "customer") {
    return active.find((wallet) => firstString(wallet, ["wallet_type", "walletType"]) === "customer" && firstString(wallet, ["owner_entity_type", "ownerEntityType"]) === "user") ?? null;
  }
  if (workspace === "driver") {
    return active.find((wallet) => firstString(wallet, ["wallet_type", "walletType"]) === "driver" && firstString(wallet, ["owner_entity_type", "ownerEntityType"]) === "driver") ?? null;
  }
  return active.find((wallet) => firstString(wallet, ["wallet_type", "walletType"]) === "partner" && firstString(wallet, ["owner_entity_type", "ownerEntityType"]) === "organization")
    ?? active.find((wallet) => firstString(wallet, ["wallet_type", "walletType"]) === "partner")
    ?? null;
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
  heroLabel: { color: "rgba(255,255,255,.76)", ...typography.eyebrow, fontSize: 9 },
  heroAmount: { color: "#FFFFFF", fontSize: 33, lineHeight: 40, fontWeight: "900", letterSpacing: -0.7, marginTop: 4, maxWidth: 280 },
  heroShield: { width: 46, height: 46, borderRadius: 16, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  heroBody: { color: "rgba(255,255,255,.84)", ...typography.caption, lineHeight: 18 },
  beneficiaryList: { gap: spacing.sm },
  beneficiary: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth },
  beneficiaryIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  beneficiaryCopy: { flex: 1, gap: 2 },
  beneficiaryName: { ...typography.bodyStrong, fontSize: 14 },
  beneficiaryMeta: { ...typography.caption },
  bankSection: { gap: spacing.sm, marginBottom: spacing.md },
  fieldLabel: { ...typography.bodyStrong, fontSize: 13 },
  searchShell: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, minHeight: 46, fontSize: 14 },
  bankGrid: { gap: spacing.xs },
  bankOption: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth },
  bankOptionCopy: { flex: 1 },
  bankName: { ...typography.bodyStrong, fontSize: 13 },
  bankCodeText: { ...typography.caption, fontSize: 10 },
  configurationNotice: { padding: spacing.md, borderRadius: radii.md, marginBottom: spacing.md },
  configurationText: { ...typography.caption, lineHeight: 18 },
  message: { padding: spacing.md, borderRadius: radii.md },
  messageText: { ...typography.caption, fontWeight: "700", lineHeight: 18 },
});
