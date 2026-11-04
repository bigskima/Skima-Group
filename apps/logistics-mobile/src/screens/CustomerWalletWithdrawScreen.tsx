import { router, useLocalSearchParams } from "expo-router";
import { Building2, CheckCircle2, ChevronRight, Plus, ShieldCheck } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { createClientIdempotencyKey } from "@skima/frontend-core";
import { z } from "zod";
import { useLogisticsQuery, asString, asNumber } from "../api/logistics";
import { useLogisticsFinanceMutation, useLogisticsFinanceQuery } from "../api/finance";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii } from "../theme/tokens";
import { Screen } from "../ui/Screen";
import { StatePanel } from "../ui/StatePanel";

const RecordSchema = z.record(z.string(), z.unknown());
const ArraySchema = z.array(RecordSchema);
const money = (value: number, currency: string) => {
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency} ${value.toFixed(2)}`; }
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const banksFrom = (value: Record<string, unknown> | undefined) => {
  const source = Array.isArray(value?.banks) ? value.banks : [];
  return source.map(record).map(item => ({ name: asString(item, "name", "display_name") ?? "", code: asString(item, "code", "bank_code") ?? "" })).filter(item => item.name && item.code).sort((a,b) => a.name.localeCompare(b.name));
};

export function CustomerWalletWithdrawScreen() {
  const { palette } = useAppTheme();
  const { session } = useSession();
  const params = useLocalSearchParams<{ walletId?: string | string[] }>();
  const requestedWalletId = Array.isArray(params.walletId) ? params.walletId[0] : params.walletId;
  const wallets = useLogisticsQuery(["customer-wallets"], "/runtime/wallets", true, 30000);
  const balances = useLogisticsQuery(["customer-wallet-balances"], "/runtime/wallet-balances", true, 30000);
  const wallet = (wallets.data ?? []).find(w => asString(w, "wallet_type") === "customer" && asString(w, "owner_entity_type") === "user" && asString(w, "owner_entity_id") === session?.user.id && (!requestedWalletId || asString(w, "id", "wallet_id") === requestedWalletId) && !["closed", "disabled"].includes((asString(w, "status", "wallet_status") ?? "").toLowerCase())) ?? null;
  const walletId = asString(wallet, "id", "wallet_id");
  const currency = asString(wallet, "currency_code") ?? "NGN";
  const available = asNumber((balances.data ?? []).find(b => asString(b, "wallet_id") === walletId), "balance") ?? asNumber(wallet, "available_balance", "availableBalance", "balance") ?? 0;

  const bankQuery = useLogisticsFinanceQuery({ key: ["banks"], path: "/banks", schema: RecordSchema });
  const beneficiaryQuery = useLogisticsFinanceQuery({ key: ["beneficiaries"], path: "/beneficiaries", schema: ArraySchema });
  const bankList = useMemo(() => banksFrom(bankQuery.data), [bankQuery.data]);
  const beneficiaries = (beneficiaryQuery.data ?? []).filter(b => asString(b, "wallet_id", "walletId") === walletId && asString(b, "status") === "verified");
  const bankNames = new Map(bankList.map(b => [b.code, b.name]));

  const [bankSearch, setBankSearch] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);
  const [message, setMessage] = useState("");
  const [feePreview, setFeePreview] = useState<Record<string, unknown> | null>(null);
  const [receipt, setReceipt] = useState<Record<string, unknown> | null>(null);
  const [beneficiaryKey, setBeneficiaryKey] = useState(() => createClientIdempotencyKey("logistics.wallet.beneficiary", walletId ?? session?.user.id ?? "customer"));
  const [withdrawalKey, setWithdrawalKey] = useState(() => createClientIdempotencyKey("logistics.wallet.withdrawal", walletId ?? session?.user.id ?? "customer"));
  useEffect(() => {
    setBeneficiaryKey(createClientIdempotencyKey("logistics.wallet.beneficiary", walletId ?? session?.user.id ?? "customer"));
    setWithdrawalKey(createClientIdempotencyKey("logistics.wallet.withdrawal", walletId ?? session?.user.id ?? "customer"));
  }, [walletId, session?.user.id]);

  const resolveAccount = useLogisticsFinanceMutation({ path: "/beneficiaries/resolve", schema: RecordSchema });
  const addBeneficiary = useLogisticsFinanceMutation({ path: "/beneficiaries", schema: RecordSchema });
  const preview = useLogisticsFinanceMutation({ path: "/withdrawals/preview", schema: RecordSchema });
  const withdraw = useLogisticsFinanceMutation({ path: "/withdrawals", schema: RecordSchema });
  const retry = useLogisticsFinanceMutation({ path: "/withdrawals/retry", schema: RecordSchema });

  const filteredBanks = bankList.filter(b => !bankSearch.trim() || b.name.toLowerCase().includes(bankSearch.trim().toLowerCase()) || b.code.includes(bankSearch.trim()));
  const fee = asNumber(feePreview, "calculatedFeeAmount", "calculated_fee_amount") ?? 0;
  const debit = asNumber(feePreview, "totalDebitAmount", "total_debit_amount") ?? Number(amount) + fee;
  const amountValue = Number(amount);
  const verificationAvailable = bankQuery.data?.beneficiaryVerificationAvailable === true;
  const providerMessage = asString(bankQuery.data, "providerIssueMessage", "provider_issue_message");

  async function verifyAccount() {
    setMessage("");
    if (!walletId || !/^\\d{10}$/.test(accountNumber) || !bankCode) { setMessage("Choose a bank and enter a valid 10-digit account number."); return; }
    try {
      const result = await resolveAccount.mutateAsync({ walletId, bankCode, accountNumber });
      const name = asString(result, "accountName", "account_name");
      if (!name || asString(result, "accountNumber", "account_number") !== accountNumber || asString(result, "bankCode", "bank_code") !== bankCode) {
        throw new Error("The account details did not match the bank verification result.");
      }
      setAccountName(name);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Bank account verification failed."); }
  }

  async function saveAccount() {
    if (!walletId || !accountName) return;
    setMessage("");
    try {
      const result = await addBeneficiary.mutateAsync({
        walletId, bankCode, accountNumber,
        idempotencyKey: beneficiaryKey,
      });
      const id = asString(result, "id");
      await beneficiaryQuery.refetch();
      if (id) setDestination(id);
      setAddingAccount(false); setAccountNumber(""); setAccountName(""); setBankCode(""); setBankSearch("");
      setBeneficiaryKey(createClientIdempotencyKey("logistics.wallet.beneficiary", walletId));
      setMessage("Verified payout account saved.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The payout account could not be saved."); }
  }

  async function reviewWithdrawal() {
    setMessage(""); setReceipt(null);
    if (!walletId || !destination || !Number.isFinite(amountValue) || amountValue <= 0) { setMessage("Choose a verified account and enter a valid amount."); return; }
    if (amountValue > available) { setMessage("The withdrawal amount is higher than your available balance."); return; }
    try {
      const result = await preview.mutateAsync({ walletId, amount: amountValue });
      const totalDebit = asNumber(result, "totalDebitAmount", "total_debit_amount") ?? amountValue + (asNumber(result, "calculatedFeeAmount", "calculated_fee_amount") ?? 0);
      if (totalDebit > available) { setMessage("Your balance must cover both the withdrawal and the SKIMA fee."); return; }
      setFeePreview(result);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Withdrawal fee preview failed."); }
  }

  async function confirmWithdrawal() {
    if (!walletId || !destination || !Number.isFinite(amountValue) || amountValue <= 0) return;
    setMessage("");
    try {
      const result = await withdraw.mutateAsync({
        walletId, beneficiaryId: destination, amount: amountValue,
        idempotencyKey: withdrawalKey,
      });
      setReceipt(result); setFeePreview(null);
      setWithdrawalKey(createClientIdempotencyKey("logistics.wallet.withdrawal", walletId));
      await Promise.all([wallets.refetch(), balances.refetch(), beneficiaryQuery.refetch()]);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The withdrawal could not be submitted."); }
  }

  async function retryTransfer() {
    const id = asString(receipt, "id");
    if (!id) return;
    setMessage("");
    try {
      const result = await retry.mutateAsync({ withdrawalRequestId: id });
      setReceipt(result);
      await Promise.all([wallets.refetch(), balances.refetch()]);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The transfer retry could not be completed."); }
  }

  const receiptStatus = (asString(receipt, "status") ?? "").toLowerCase();
  const transfer = record(receipt?.transfer);
  const transferStatus = (asString(transfer, "providerStatus", "provider_status", "status") ?? "").toLowerCase();
  const reference = asString(receipt, "public_reference", "publicReference", "reference", "id");

  return <Screen title="Withdraw from SKIMA Wallet" denseHeader>
    <Pressable onPress={() => router.back()}><Text style={{ color: palette.brand, fontSize: 11, fontWeight: "900" }}>‹ Back to wallet</Text></Pressable>
    {wallets.isPending || balances.isPending ? <ActivityIndicator color={palette.brand} /> : !walletId ? <StatePanel title="Customer wallet unavailable" description="We could not find the shared customer wallet for this account." retry={() => void Promise.all([wallets.refetch(), balances.refetch()])} /> : <>
      <View style={[styles.hero, { backgroundColor: palette.brand }]}><Text style={styles.kicker}>AVAILABLE TO WITHDRAW</Text><Text style={styles.balance}>{money(available, currency)}</Text><Text style={styles.hint}>Payouts use the same customer wallet balance shared with LPG and Logistics Store.</Text></View>
      {receipt ? <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}><View style={styles.row}><CheckCircle2 color={receiptStatus === "failed" || transferStatus === "failed" ? palette.danger : palette.success} size={20} /><Text style={[styles.heading, { color: palette.ink }]}>{receiptStatus === "succeeded" || transferStatus === "succeeded" ? "Withdrawal sent" : receiptStatus === "processing" || transferStatus === "processing" ? "Transfer processing" : "Withdrawal submitted"}</Text></View><Text style={[styles.hintDark, { color: palette.muted }]}>Status: {receiptStatus || transferStatus || "processing"}{reference ? ` · Ref ${reference}` : ""}</Text>{receiptStatus === "approved" ? <Pressable onPress={() => void retryTransfer()} disabled={retry.isPending} style={[styles.button, { backgroundColor: palette.brand }]}>{retry.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Retry bank transfer</Text>}</Pressable> : null}<Pressable onPress={() => router.replace("/(customer)/wallet" as never)}><Text style={{ color: palette.brand, fontWeight: "900", fontSize: 11 }}>Done</Text></Pressable></View> : <>
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.row}><ShieldCheck color={palette.success} size={18} /><Text style={[styles.heading, { color: palette.ink }]}>Verified payout account</Text></View>
          {beneficiaryQuery.isPending ? <ActivityIndicator color={palette.brand} /> : beneficiaries.length ? beneficiaries.map(b => {
            const id = asString(b, "id") ?? "";
            const code = asString(b, "bank_code", "bankCode") ?? "";
            const active = id === destination;
            return <Pressable key={id} onPress={() => { setDestination(id); setFeePreview(null); }} style={[styles.beneficiary, { borderColor: active ? palette.brand : palette.border, backgroundColor: active ? palette.brandSoft : palette.surface }]}><Building2 color={palette.brand} size={18} /><View style={{ flex: 1 }}><Text style={[styles.bankName, { color: palette.ink }]}>{asString(b, "account_name", "accountName") ?? "Payout account"}</Text><Text style={[styles.hintDark, { color: palette.muted }]}>{bankNames.get(code) ?? "Bank"} · •••• {asString(b, "account_number_last4", "accountNumberLast4") ?? "••••"}</Text></View><ChevronRight color={active ? palette.brand : palette.muted} size={17} /></Pressable>;
          }) : <Text style={[styles.hintDark, { color: palette.muted }]}>No verified payout account is saved for this wallet yet.</Text>}
          <Pressable onPress={() => { setAddingAccount(v => !v); setMessage(""); }} style={styles.addLink}><Plus color={palette.brand} size={16} /><Text style={{ color: palette.brand, fontWeight: "900", fontSize: 11 }}>{addingAccount ? "Close account form" : "Add payout account"}</Text></Pressable>
          {addingAccount ? <View style={styles.form}>
            <TextInput value={bankSearch} onChangeText={setBankSearch} placeholder="Search Nigerian bank" placeholderTextColor={palette.muted} style={[styles.input, { color: palette.ink, borderColor: palette.border }]} />
            {bankQuery.isPending ? <ActivityIndicator color={palette.brand} /> : filteredBanks.slice(0, 8).map(b => <Pressable key={b.code} onPress={() => { setBankCode(b.code); setAccountName(""); }} style={[styles.bankOption, { backgroundColor: bankCode === b.code ? palette.brandSoft : palette.surfaceSubtle, borderColor: bankCode === b.code ? palette.brand : palette.border }]}><Text style={{ color: palette.ink, fontSize: 11 }}>{b.name}</Text></Pressable>)}
            <TextInput value={accountNumber} onChangeText={v => { setAccountNumber(v.replace(/\\D/g, "").slice(0, 10)); setAccountName(""); }} keyboardType="number-pad" maxLength={10} placeholder="10-digit account number" placeholderTextColor={palette.muted} style={[styles.input, { color: palette.ink, borderColor: palette.border }]} />
            {accountName ? <Text style={{ color: palette.success, fontSize: 11, fontWeight: "900" }}>Verified: {accountName}</Text> : null}
            {!verificationAvailable ? <Text style={[styles.hintDark, { color: palette.muted }]}>{providerMessage ?? "New account verification is temporarily unavailable. Existing verified accounts can still be used."}</Text> : <Pressable disabled={resolveAccount.isPending} onPress={() => void verifyAccount()} style={[styles.button, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border, borderWidth: 1 }]}>{resolveAccount.isPending ? <ActivityIndicator color={palette.brand} /> : <Text style={{ color: palette.brand, fontWeight: "900" }}>Verify account</Text>}</Pressable>}
            <Pressable disabled={!accountName || addBeneficiary.isPending} onPress={() => void saveAccount()} style={[styles.button, { backgroundColor: palette.brand, opacity: !accountName || addBeneficiary.isPending ? 0.5 : 1 }]}>{addBeneficiary.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save verified account</Text>}</Pressable>
          </View> : null}
        </View>
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.heading, { color: palette.ink }]}>Withdrawal amount ({currency})</Text>
          <TextInput value={amount} onChangeText={v => { setAmount(v.replace(/[^0-9.]/g, "")); setFeePreview(null); }} keyboardType="decimal-pad" placeholder="Enter amount" placeholderTextColor={palette.muted} style={[styles.input, { color: palette.ink, borderColor: palette.border }]} />
          {feePreview ? <View style={{ gap: 9 }}><View style={styles.line}><Text style={{ color: palette.muted }}>Amount to bank</Text><Text style={{ color: palette.ink }}>{money(amountValue, currency)}</Text></View><View style={styles.line}><Text style={{ color: palette.muted }}>SKIMA fee</Text><Text style={{ color: palette.ink }}>{money(fee, currency)}</Text></View><View style={styles.line}><Text style={{ color: palette.ink, fontWeight: "900" }}>Total wallet debit</Text><Text style={{ color: palette.ink, fontWeight: "900" }}>{money(debit, currency)}</Text></View><Pressable disabled={withdraw.isPending} onPress={() => void confirmWithdrawal()} style={[styles.button, { backgroundColor: palette.brand }]}>{withdraw.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Confirm withdrawal</Text>}</Pressable></View> : <Pressable disabled={preview.isPending || !destination || !amount.trim()} onPress={() => void reviewWithdrawal()} style={[styles.button, { backgroundColor: palette.brand, opacity: preview.isPending || !destination || !amount.trim() ? 0.5 : 1 }]}>{preview.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Review withdrawal fee</Text>}</Pressable>}
        </View>
      </>}
      {message ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>{message}</Text> : null}
    </>}
  </Screen>;
}
const styles = StyleSheet.create({
  hero: { borderRadius: radii.lg, padding: 16, gap: 7 }, kicker: { color: "rgba(255,255,255,.78)", fontSize: 9, fontWeight: "900", letterSpacing: 1 }, balance: { color: "#fff", fontSize: 27, fontWeight: "900" }, hint: { color: "rgba(255,255,255,.83)", fontSize: 11, lineHeight: 16 }, hintDark: { fontSize: 10, lineHeight: 15 }, card: { borderWidth: 1, borderRadius: radii.lg, padding: 14, gap: 11 }, row: { flexDirection: "row", alignItems: "center", gap: 8 }, heading: { fontSize: 12, fontWeight: "900" }, beneficiary: { borderWidth: 1, borderRadius: radii.md, padding: 10, flexDirection: "row", alignItems: "center", gap: 9 }, bankName: { fontSize: 11, fontWeight: "800" }, addLink: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 5 }, form: { gap: 8 }, input: { height: 43, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 10, fontSize: 12 }, bankOption: { borderWidth: 1, borderRadius: radii.md, padding: 8 }, button: { minHeight: 42, borderRadius: radii.md, alignItems: "center", justifyContent: "center", padding: 9 }, buttonText: { color: "#fff", fontWeight: "900", fontSize: 11 }, line: { flexDirection: "row", justifyContent: "space-between", gap: 10 }, error: { fontSize: 11, fontWeight: "800", lineHeight: 16 },
});
