import { useEffect, useMemo, useState } from "react";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ArrowLeft, Banknote, CheckCircle2, ChevronRight, ShieldCheck, WalletCards } from "lucide-react-native";
import { z } from "zod";
import { useLogisticsQuery, asString, asNumber, RecordSchema } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { Screen } from "../ui/Screen";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { StatePanel } from "../ui/StatePanel";

const MoneySchema = z.record(z.string(), z.unknown());
const idempotency = (prefix: string) => `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2,10)}`;
const formatMoney = (value: number, currency: string) => new Intl.NumberFormat("en-NG", { style:"currency", currency, maximumFractionDigits:2 }).format(value);
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

export function CompanyFinanceScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const queryClient = useQueryClient();
  const companyQuery = useLogisticsQuery(["finance-company"], "/runtime/logistics/company", true, 45_000);
  const company = companyQuery.data?.[0] ?? null;
  const organizationId = asString(company, "organization_id");
  const wallets = useLogisticsQuery(["finance-wallets"], "/runtime/wallets", Boolean(organizationId), 30_000);
  const balances = useLogisticsQuery(["finance-balances"], "/runtime/wallet-balances", Boolean(organizationId), 30_000);
  const bookings = useLogisticsQuery(["finance-bookings", organizationId], `/runtime/logistics/bookings?providerOrganizationId=${encodeURIComponent(organizationId ?? "")}`, Boolean(organizationId), 30_000);
  const beneficiaries = useLogisticsQuery(["finance-beneficiaries"], "/runtime/withdrawal-beneficiaries", Boolean(organizationId), 30_000);
  const withdrawals = useLogisticsQuery(["finance-withdrawals"], "/runtime/withdrawals", Boolean(organizationId), 30_000);
  const earningsWallets = (wallets.data ?? []).filter((w) => asString(w,"wallet_type")==="logistics_earnings" && asString(w,"owner_entity_type")==="organization" && asString(w,"owner_entity_id")===organizationId && asString(w,"status")==="active");
  const [currency,setCurrency]=useState("NGN");
  const availableCurrencies = [...new Set(earningsWallets.map((wallet)=>asString(wallet,"currency_code")).filter((value):value is string=>Boolean(value)))];
  useEffect(()=>{ if(availableCurrencies.length && !availableCurrencies.includes(currency)) setCurrency(availableCurrencies[0]); },[availableCurrencies.join("|"),currency]);
  const earningsWallet = earningsWallets.find((wallet)=>asString(wallet,"currency_code")===currency) ?? null;
  const operatingWallets = (wallets.data ?? []).filter((w) => asString(w,"wallet_type")==="partner" && asString(w,"owner_entity_type")==="organization" && asString(w,"owner_entity_id")===organizationId && asString(w,"status")==="active" && asString(w,"currency_code")===currency);
  const walletBalance = (wallet: Record<string,unknown> | null) => wallet ? asNumber((balances.data??[]).find((b)=>asString(b,"wallet_id")===asString(wallet,"id")),"balance")??0 : 0;
  const earningsBalance = walletBalance(earningsWallet);
  const operatingBalance = operatingWallets.reduce((sum,w)=>sum+walletBalance(w),0);
  const walletId = asString(earningsWallet,"id");
  useEffect(()=>{ setBeneficiaryId(""); setPreview(null); setAmount(""); },[walletId]);
  const payoutBeneficiaries = (beneficiaries.data??[]).filter((item)=>asString(item,"wallet_id")===walletId && asString(item,"status")==="verified");

  const settings = useQuery({
    queryKey:["logistics-company-payment-settings",organizationId],
    enabled:Boolean(organizationId && session.status==="authenticated"),
    queryFn:async()=>{
      const {data,error}=await session.supabase.rpc("read_logistics_company_payment_settings",{target_organization_id:organizationId});
      if(error) throw error;
      return record(data);
    },
  });
  const paymentRecords = useQuery({
    queryKey:["logistics-driver-payment-records",organizationId],
    enabled:Boolean(organizationId && session.status==="authenticated"),
    queryFn:async()=>{
      const {data,error}=await session.supabase.rpc("read_logistics_company_driver_payments",{target_organization_id:organizationId});
      if(error) throw error;
      return Array.isArray(data)?data.map(record):[];
    },
  });
  const paymentMethod = asString(settings.data,"default_driver_payment_method") ?? "offline";
  const [amount,setAmount]=useState("");
  const [beneficiaryId,setBeneficiaryId]=useState("");
  const [bankCode,setBankCode]=useState("");
  const [accountNumber,setAccountNumber]=useState("");
  const [newBeneficiary,setNewBeneficiary]=useState(false);
  const [preview,setPreview]=useState<Record<string,unknown>|null>(null);
  const [payingBooking,setPayingBooking]=useState<Record<string,unknown>|null>(null);
  const [driverAmount,setDriverAmount]=useState("");
  const [driverNote,setDriverNote]=useState("");

  const banksQuery=useQuery({
    queryKey:["logistics-payout-banks"],
    queryFn:()=>session.api.get("/runtime/banks",MoneySchema),
    enabled:Boolean(newBeneficiary && organizationId && walletId),
  });
  const bankRows=Array.isArray(banksQuery.data?.banks)?banksQuery.data!.banks as Record<string,unknown>[]:[];
  const allPayments=paymentRecords.data??[];
  const paidBookingIds=new Set(allPayments.map((p)=>asString(p,"booking_id")).filter(Boolean));
  const completedBookings=useMemo(()=>(bookings.data??[]).filter((b)=>{
    const state=(asString(b,"status")??"").toLowerCase();
    const assignments=Array.isArray(b.assignments)?b.assignments as Record<string,unknown>[]:[];
    return ["settled","completed_offline"].includes(state) && assignments.some((a)=>asString(a,"status")==="completed") && !paidBookingIds.has(asString(b,"id")??"");
  }),[bookings.data,paidBookingIds.size,paymentRecords.data]);

  const saveMethod=useMutation({
    mutationFn:async(method:"offline"|"skima_wallet")=>{
      if(!organizationId) throw new Error("Company profile is unavailable.");
      const {data,error}=await session.supabase.rpc("update_logistics_company_payment_settings",{target_organization_id:organizationId,target_default_driver_payment_method:method});
      if(error) throw error;
      return record(data);
    },
    onSuccess:async()=>{await settings.refetch();Alert.alert("Payment setting saved","New driver payments will use the selected company method.");},
    onError:(e)=>Alert.alert("Could not save setting",e instanceof Error?e.message:"Please try again."),
  });

  const configureBeneficiary=useMutation({
    mutationFn:async()=>{
      if(!walletId || !bankCode || !/^\d{10}$/.test(accountNumber)) throw new Error("Choose a bank and enter a valid 10-digit account number.");
      const resolved=await session.api.post("/runtime/withdrawal-beneficiaries/resolve",{walletId,bankCode,accountNumber},MoneySchema);
      const accountName=asString(resolved,"accountName","account_name");
      if(!accountName) throw new Error("The bank account name could not be verified.");
      return session.api.post("/runtime/withdrawal-beneficiaries",{
        walletId,bankCode,accountNumber,accountName,idempotencyKey:idempotency("logistics-company-beneficiary"),
        metadata:{moduleKey:"logistics_network",purpose:"company_earnings_withdrawal"},
      },RecordSchema);
    },
    onSuccess:async(result)=>{
      const id=asString(result,"id"); if(id) setBeneficiaryId(id);
      setNewBeneficiary(false);setAccountNumber("");
      await beneficiaries.refetch();
      Alert.alert("Payout account saved","Your verified company earnings payout account is ready.");
    },
    onError:(e)=>Alert.alert("Account verification failed",e instanceof Error?e.message:"Please try again."),
  });

  const makePreview=useMutation({
    mutationFn:()=>session.api.post("/runtime/withdrawals/preview",{walletId,amount:Number(amount)},MoneySchema),
    onSuccess:(result)=>setPreview(record(result)),
    onError:(e)=>Alert.alert("Withdrawal preview failed",e instanceof Error?e.message:"Please check the amount."),
  });
  const withdraw=useMutation({
    mutationFn:()=>session.api.post("/runtime/withdrawals",{
      walletId,beneficiaryId:beneficiaryId || asString(payoutBeneficiaries[0],"id"),
      amount:Number(amount),idempotencyKey:idempotency("logistics-company-withdrawal"),
      metadata:{moduleKey:"logistics_network",walletRole:"logistics_earnings"},
    },MoneySchema),
    onSuccess:async(result)=>{
      setAmount("");setPreview(null);
      await Promise.all([balances.refetch(),withdrawals.refetch()]);
      Alert.alert("Withdrawal submitted",`Status: ${asString(record(result),"status")??"processing"}. The configured SKIMA withdrawal fee policy was applied.`);
    },
    onError:(e)=>Alert.alert("Withdrawal failed",e instanceof Error?e.message:"Please try again."),
  });

  const recordDriverPayment=useMutation({
    mutationFn:async()=>{
      if(!organizationId || !payingBooking) throw new Error("Select a completed job.");
      const {data,error}=await session.supabase.rpc("record_logistics_driver_payment",{
        target_booking_id:asString(payingBooking,"id"),
        target_amount:Number(driverAmount),
        target_payment_method:paymentMethod,
        target_note:driverNote,
        target_idempotency_key:idempotency("logistics-driver-payment"),
      });
      if(error) throw error;
      return record(data);
    },
    onSuccess:async(result)=>{
      setPayingBooking(null);setDriverAmount("");setDriverNote("");
      await Promise.all([paymentRecords.refetch(),balances.refetch(),bookings.refetch()]);
      Alert.alert("Driver payment recorded",asString(result,"status")==="paid"?"The driver's SKIMA Wallet was credited.":"The offline payment record was saved.");
    },
    onError:(e)=>Alert.alert("Driver payment failed",e instanceof Error?e.message:"Please verify the driver and available funds."),
  });

  const canWithdraw=Boolean(walletId && Number(amount)>0 && (beneficiaryId || payoutBeneficiaries.length) && earningsBalance>=Number(asNumber(preview,"totalDebitAmount")??Number(amount)));
  if(companyQuery.isPending) return <Screen title="Company wallet" denseHeader><ScreenSkeleton cards={2}/></Screen>;
  if(!company || !organizationId) return <Screen title="Company wallet" denseHeader><StatePanel title="Company profile unavailable" description="Set up the company profile before accessing company funds." retry={()=>void companyQuery.refetch()}/></Screen>;

  return (
    <Screen title="Company wallet" denseHeader>
      <Pressable onPress={()=>router.back()} style={styles.back}><ArrowLeft color={palette.ink} size={17}/><Text style={{color:palette.ink,fontWeight:"800",fontSize:11}}>Workspace</Text></Pressable>
      {settings.isError ? <StatePanel title="Finance access is restricted" description="Only the authorized company owner can manage payout settings and company earnings."/> : null}
      {availableCurrencies.length>1?<View style={styles.currencyRow}>{availableCurrencies.map((code)=><Pressable key={code} onPress={()=>setCurrency(code)} style={[styles.currencyChip,{backgroundColor:currency===code?palette.brandSoft:palette.surface,borderColor:currency===code?palette.brand:palette.border}]}><Text style={{color:currency===code?palette.brand:palette.ink,fontSize:10,fontWeight:"900"}}>{code}</Text></Pressable>)}</View>:null}
      <View style={[styles.balanceCard,{backgroundColor:palette.surface,borderColor:palette.border}]}>
        <View style={styles.balanceHead}><View style={[styles.icon,{backgroundColor:palette.brandSoft}]}><WalletCards color={palette.brand} size={20}/></View><View style={{flex:1}}><Text style={[styles.label,{color:palette.muted}]}>LOGISTICS EARNINGS</Text><Text style={[styles.balance,{color:palette.ink}]}>{formatMoney(earningsBalance,currency)}</Text></View><ShieldCheck color={palette.success} size={19}/></View>
        <Text style={[styles.hint,{color:palette.muted}]}>Only customer-confirmed online Logistics settlements are withdrawable.</Text>
      </View>
      <View style={[styles.operatingCard,{backgroundColor:palette.surfaceSubtle,borderColor:palette.border}]}>
        <Text style={[styles.operatingTitle,{color:palette.ink}]}>Operating-fee wallet</Text>
        <Text style={[styles.operatingAmount,{color:palette.ink}]}>{formatMoney(operatingBalance,currency)}</Text>
        <Text style={[styles.hint,{color:palette.muted}]}>Separate partner wallet. Used for offline receival fees and company top-ups; not withdrawable as Logistics earnings.</Text>
      </View>

      <View style={[styles.panel,{backgroundColor:palette.surface,borderColor:palette.border}]}>
        <Text style={[styles.panelTitle,{color:palette.ink}]}>Withdraw earnings</Text>
        {!walletId ? <Text style={[styles.hint,{color:palette.muted}]}>Your earnings wallet will appear after the first online booking is confirmed by its customer.</Text> : (
          <>
            {payoutBeneficiaries.length ? payoutBeneficiaries.map((item)=>(
              <Pressable key={String(item.id)} onPress={()=>setBeneficiaryId(String(item.id))} style={[styles.beneficiary,{borderColor:(beneficiaryId||asString(payoutBeneficiaries[0],"id"))===String(item.id)?palette.brand:palette.border,backgroundColor:palette.surfaceSubtle}]}>
                <Banknote color={palette.brand} size={17}/><View style={{flex:1}}><Text style={[styles.beneficiaryName,{color:palette.ink}]}>{asString(item,"account_name")??"Verified account"}</Text><Text style={[styles.hint,{color:palette.muted}]}>•••• {asString(item,"account_number_last4")??""}</Text></View><CheckCircle2 color={palette.success} size={16}/>
              </Pressable>
            )) : null}
            <Pressable onPress={()=>setNewBeneficiary((v)=>!v)} style={styles.addBank}><Text style={{color:palette.brand,fontSize:11,fontWeight:"900"}}>{newBeneficiary?"Close":"Add payout bank account"}</Text><ChevronRight color={palette.brand} size={16}/></Pressable>
            {newBeneficiary ? (
              <View style={{gap:8}}>
                {banksQuery.isPending?<ActivityIndicator color={palette.brand}/>:<View style={styles.bankGrid}>{bankRows.slice(0,12).map((bank)=>{const code=asString(bank,"code")??"";return <Pressable key={code} onPress={()=>setBankCode(code)} style={[styles.bankChip,{borderColor:bankCode===code?palette.brand:palette.border,backgroundColor:bankCode===code?palette.brandSoft:palette.surface}]}><Text numberOfLines={1} style={{fontSize:9,fontWeight:"800",color:palette.ink}}>{asString(bank,"name","display_name")??code}</Text></Pressable>;})}</View>}
                <TextInput value={accountNumber} onChangeText={setAccountNumber} keyboardType="number-pad" maxLength={10} placeholder="10-digit account number" placeholderTextColor={palette.muted} style={[styles.input,{borderColor:palette.border,color:palette.ink}]}/>
                <Action label="Verify & save bank" busy={configureBeneficiary.isPending} onPress={()=>configureBeneficiary.mutate()}/>
              </View>
            ):null}
            <TextInput value={amount} onChangeText={(v)=>{setAmount(v);setPreview(null);}} keyboardType="decimal-pad" placeholder={`Withdrawal amount (${currency})`} placeholderTextColor={palette.muted} style={[styles.input,{borderColor:palette.border,color:palette.ink}]}/>
            <Action label="Preview withdrawal fee" busy={makePreview.isPending} disabled={!walletId || !Number(amount)||!Number.isFinite(Number(amount))||Number(amount)<=0} onPress={()=>makePreview.mutate()}/>
            {preview ? <Text style={[styles.hint,{color:palette.muted}]}>Fee: {formatMoney(Number(asNumber(preview,"calculatedFeeAmount")??0),currency)} · Total debit: {formatMoney(Number(asNumber(preview,"totalDebitAmount")??Number(amount)),currency)}</Text>:null}
            <Action label="Withdraw to bank" busy={withdraw.isPending} disabled={!canWithdraw|| (payoutBeneficiaries.length===0&&!beneficiaryId)} onPress={()=>withdraw.mutate()}/>
          </>
        )}
      </View>

      <View style={[styles.panel,{backgroundColor:palette.surface,borderColor:palette.border}]}>
        <Text style={[styles.panelTitle,{color:palette.ink}]}>Driver payment method</Text>
        <Text style={[styles.hint,{color:palette.muted}]}>Choose the company default for completed Logistics jobs.</Text>
        <View style={styles.methodRow}>
          <Method label="SKIMA Wallet" detail="Automatic ledger transfer" active={paymentMethod==="skima_wallet"} onPress={()=>saveMethod.mutate("skima_wallet")}/>
          <Method label="Offline / manual" detail="Company pays directly" active={paymentMethod==="offline"} onPress={()=>saveMethod.mutate("offline")}/>
        </View>
        <Text style={[styles.hint,{color:palette.muted}]}>SKIMA Wallet payments require a settled online booking, company earnings balance and an active driver wallet in the same currency. Offline payments are recorded without moving SKIMA funds.</Text>
      </View>

      <View style={[styles.panel,{backgroundColor:palette.surface,borderColor:palette.border}]}>
        <Text style={[styles.panelTitle,{color:palette.ink}]}>Completed jobs awaiting driver payment</Text>
        {bookings.isPending||paymentRecords.isPending?<ScreenSkeleton cards={1}/>:completedBookings.length===0?<Text style={[styles.hint,{color:palette.muted}]}>No completed assigned jobs awaiting a payment record.</Text>:completedBookings.slice(0,6).map((booking)=>{
          const assignment=(Array.isArray(booking.assignments)?booking.assignments as Record<string,unknown>[]:[]).find((a)=>asString(a,"status")==="completed");
          const driver=record(assignment?.driver);
          return <View key={String(booking.id)} style={[styles.booking,{borderColor:palette.border}]}>
            <View style={{flex:1,gap:2}}><Text style={[styles.beneficiaryName,{color:palette.ink}]}>{asString(record(booking.job),"title")??"Completed Logistics job"}</Text><Text style={[styles.hint,{color:palette.muted}]}>{asString(driver,"driver_display_name")??"Assigned driver"} · {asString(booking,"currency_code")??currency}</Text></View>
            <Pressable onPress={()=>{setPayingBooking(booking);setDriverAmount(String(asNumber(booking,"provider_net_amount")??""));}} style={[styles.smallButton,{backgroundColor:palette.brandSoft}]}><Text style={{color:palette.brand,fontSize:10,fontWeight:"900"}}>Pay driver</Text></Pressable>
          </View>;
        })}
        {payingBooking ? <View style={[styles.payForm,{borderColor:palette.brand}]}>
          <Text style={[styles.beneficiaryName,{color:palette.ink}]}>Pay assigned driver</Text>
          <TextInput value={driverAmount} onChangeText={setDriverAmount} keyboardType="decimal-pad" placeholder="Amount" placeholderTextColor={palette.muted} style={[styles.input,{borderColor:palette.border,color:palette.ink}]}/>
          {paymentMethod==="offline"?<TextInput value={driverNote} onChangeText={setDriverNote} placeholder="Payment reference / note" placeholderTextColor={palette.muted} style={[styles.input,{borderColor:palette.border,color:palette.ink}]}/>:null}
          <Action label={paymentMethod==="skima_wallet"?"Pay from company earnings":"Record offline payment"} busy={recordDriverPayment.isPending} disabled={!Number(driverAmount)||Number(driverAmount)<=0||(paymentMethod==="offline"&&driverNote.trim().length<3)} onPress={()=>recordDriverPayment.mutate()}/>
          <Pressable onPress={()=>setPayingBooking(null)}><Text style={{color:palette.muted,fontSize:10,fontWeight:"800",textAlign:"center"}}>Cancel</Text></Pressable>
        </View>:null}
      </View>

      <View style={[styles.panel,{backgroundColor:palette.surface,borderColor:palette.border}]}>
        <Text style={[styles.panelTitle,{color:palette.ink}]}>Recent company withdrawals</Text>
        {(withdrawals.data??[]).filter((w)=>asString(w,"wallet_id")===walletId).slice(0,5).map((w)=><View key={String(w.id)} style={styles.withdrawRow}><Text style={[styles.hint,{color:palette.ink}]}>{formatMoney(asNumber(w,"amount")??0,asString(w,"currency_code")??currency)}</Text><Text style={[styles.hint,{color:palette.muted}]}>{asString(w,"status")??"Pending"}</Text></View>)}
        {(withdrawals.data??[]).filter((w)=>asString(w,"wallet_id")===walletId).length===0?<Text style={[styles.hint,{color:palette.muted}]}>No company withdrawals yet.</Text>:null}
      </View>
    </Screen>
  );
}

function Action({label,busy,disabled,onPress}:{label:string;busy:boolean;disabled?:boolean;onPress:()=>void}){
 const {palette}=useAppTheme();return <Pressable disabled={busy||disabled} onPress={onPress} style={[styles.action,{backgroundColor:palette.brand,opacity:busy||disabled?0.45:1}]}>{busy?<ActivityIndicator color="#fff"/>:<Text style={styles.actionText}>{label}</Text>}</Pressable>;
}
function Method({label,detail,active,onPress}:{label:string;detail:string;active:boolean;onPress:()=>void}){
 const {palette}=useAppTheme();return <Pressable onPress={onPress} style={[styles.method,{borderColor:active?palette.brand:palette.border,backgroundColor:active?palette.brandSoft:palette.surface}]}><Text style={{fontSize:11,fontWeight:"900",color:palette.ink}}>{label}</Text><Text style={{fontSize:9,color:palette.muted}}>{detail}</Text></Pressable>;
}
const styles=StyleSheet.create({
 back:{flexDirection:"row",alignItems:"center",gap:7},balanceCard:{borderWidth:StyleSheet.hairlineWidth,borderRadius:radii.lg,padding:14,gap:10},
 balanceHead:{flexDirection:"row",alignItems:"center",gap:11},icon:{width:42,height:42,borderRadius:14,alignItems:"center",justifyContent:"center"},
 label:{...typography.eyebrow,fontSize:8},balance:{fontSize:23,fontWeight:"900"},hint:{...typography.caption,fontSize:10,lineHeight:15},
 operatingCard:{borderWidth:StyleSheet.hairlineWidth,borderRadius:radii.lg,padding:13,gap:4},operatingTitle:{fontSize:11,fontWeight:"900"},operatingAmount:{fontSize:17,fontWeight:"900"},
 panel:{borderWidth:StyleSheet.hairlineWidth,borderRadius:radii.lg,padding:13,gap:10},panelTitle:{fontSize:13,fontWeight:"900"},
 beneficiary:{flexDirection:"row",alignItems:"center",gap:9,padding:10,borderWidth:1,borderRadius:radii.md},beneficiaryName:{fontSize:11,fontWeight:"900"},
 addBank:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingVertical:6},input:{minHeight:42,borderWidth:1,borderRadius:radii.md,paddingHorizontal:10,fontSize:12},
 bankGrid:{flexDirection:"row",flexWrap:"wrap",gap:7},bankChip:{maxWidth:"48%",paddingHorizontal:9,paddingVertical:8,borderWidth:1,borderRadius:radii.md},
 action:{minHeight:42,borderRadius:radii.md,alignItems:"center",justifyContent:"center",paddingHorizontal:12},actionText:{color:"#fff",fontSize:11,fontWeight:"900"},
 methodRow:{flexDirection:"row",gap:8},method:{flex:1,minHeight:64,borderWidth:1,borderRadius:radii.md,padding:10,gap:4,justifyContent:"center"},
 booking:{flexDirection:"row",alignItems:"center",gap:8,paddingVertical:8,borderBottomWidth:StyleSheet.hairlineWidth},smallButton:{paddingHorizontal:10,paddingVertical:8,borderRadius:radii.md},
 payForm:{borderWidth:1,borderRadius:radii.md,padding:10,gap:8},withdrawRow:{flexDirection:"row",justifyContent:"space-between",paddingVertical:6,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:"#8884"}
});
