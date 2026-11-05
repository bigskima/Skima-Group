import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { ArrowDownLeft, ArrowUpRight, Building2, CheckCircle2, ChevronRight, Plus, ShieldCheck, WalletCards } from "lucide-react-native";
import { z } from "zod";
import { useBillsFinanceMutation, useBillsFinanceQuery } from "../api/finance";
import { BillArraySchema, BillObjectSchema, asNumber, asString, makeIdempotencyKey, money, useBillsQuery } from "../api/bills";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { Page, Card, SectionTitle, ActionButton, Field, Notice, State } from "./BillsUI";
import { AppField } from "../ui/AppField";
import { AppButton } from "../ui/AppButton";
import { AppModal } from "../ui/AppModal";

type Row=Record<string,unknown>;
const bankSchema=z.object({banks:z.array(z.record(z.string(),z.unknown())).default([])}).passthrough();
const actionSchema=z.record(z.string(),z.unknown());
const statusName=(v:string)=>v.replaceAll("_"," ").replace(/\b\w/g,s=>s.toUpperCase());
const dateLabel=(v:string|null)=>v?new Date(v).toLocaleString("en-NG",{dateStyle:"medium",timeStyle:"short"}):"";

export function BillsWalletScreen({onOpenPage}:{onOpenPage:(page:any)=>void}){
 const {session}=useSession();const {palette}=useAppTheme();
 const wallets=useBillsQuery(["wallets"],"/runtime/wallets",BillArraySchema,true,30000);
 const balances=useBillsQuery(["wallet-balances"],"/runtime/wallet-balances",BillArraySchema,true,20000);
 const deposits=useBillsFinanceQuery({key:["deposits"],path:"/deposits",schema:BillArraySchema});
 const withdrawals=useBillsFinanceQuery({key:["withdrawals"],path:"/withdrawals",schema:BillArraySchema});
 const owner=session?.user.id??"";
 const wallet=(wallets.data??[]).find(w=>asString(w,"wallet_type","walletType")==="customer"&&asString(w,"owner_entity_type","ownerEntityType")==="user"&&asString(w,"owner_entity_id","ownerEntityId")===owner&&![ "closed","disabled" ].includes((asString(w,"status")??"").toLowerCase()))??null;
 const walletId=asString(wallet,"id","wallet_id","walletId");
 const currency=asString(wallet,"currency_code","currencyCode")??"NGN";
 const balanceRow=(balances.data??[]).find(b=>asString(b,"wallet_id","walletId","id")===walletId);
 const available=asNumber(balanceRow,"available_balance","availableBalance","balance")??asNumber(wallet,"available_balance","availableBalance","balance")??0;
 const pending=asNumber(balanceRow,"pending_balance","pendingBalance","reserved_balance","reservedBalance")??0;
 const refresh=()=>void Promise.all([wallets.refetch(),balances.refetch(),deposits.refetch(),withdrawals.refetch()]);
 const recentDeposits=(deposits.data??[]).slice(0,3);
 const recentWithdrawals=(withdrawals.data??[]).slice(0,3);
 return <Page refreshControl={<RefreshControl refreshing={wallets.isRefetching||balances.isRefetching} onRefresh={refresh} tintColor={palette.brand}/>}>
  <Card style={{gap:12}}>
   <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}><View style={{flexDirection:"row",alignItems:"center",gap:7}}><ShieldCheck color={palette.brand} size={16}/><Text style={{fontSize:10,fontWeight:"900",color:palette.muted}}>YOUR SKIMA CUSTOMER WALLET</Text></View><Text style={{fontSize:10,color:palette.success,fontWeight:"900"}}>Shared account</Text></View>
   <Text style={{fontSize:29,fontWeight:"900",color:palette.ink}}>{money(available,currency)}</Text>
   <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}><Text style={{fontSize:11,color:palette.muted}}>Available balance</Text><Text style={{fontSize:11,color:palette.muted}}>Reserved · {money(pending,currency)}</Text></View>
   <View style={{flexDirection:"row",gap:9}}>
    <View style={{flex:1}}><ActionButton label="Add funds" onPress={()=>onOpenPage("top-up")}/></View>
    <View style={{flex:1}}><ActionButton label="Withdraw" variant="secondary" onPress={()=>onOpenPage("withdraw")}/></View>
   </View>
   {!walletId&&!wallets.isPending?<Notice tone="warning" text="Your shared customer wallet is not active yet. Contact SKIMA support if it does not appear after refreshing."/>:null}
  </Card>
  <View style={{gap:9}}><SectionTitle title="Quick actions"/><View style={{flexDirection:"row",gap:8}}><View style={{flex:1}}><ActionButton label="Saved billers" variant="secondary" small onPress={()=>onOpenPage("saved")}/></View><View style={{flex:1}}><ActionButton label="Refresh balance" variant="quiet" small onPress={refresh}/></View></View></View>
  <View style={{gap:9}}><SectionTitle title="Funding activity"/>{deposits.isPending?<ActivityIndicator color={palette.brand}/>:deposits.error?<State title="Funding history unavailable" body="Please try again." retry={()=>void deposits.refetch()}/>:recentDeposits.length?recentDeposits.map((row,i)=><FinanceRow key={asString(row,"id")??String(i)} icon={<ArrowDownLeft color={palette.success} size={17}/>} title="Wallet funding" subtitle={(asString(row,"public_reference")??"Deposit")+" · "+statusName(asString(row,"status")??"pending")} amount={money(asNumber(row,"amount")??0,asString(row,"currency_code")??currency)}/>):<State title="No funding activity yet" body="Your wallet deposits will appear here after you add funds."/>}</View>
  <View style={{gap:9}}><SectionTitle title="Withdrawal activity"/>{withdrawals.isPending?<ActivityIndicator color={palette.brand}/>:withdrawals.error?<State title="Withdrawal history unavailable" body="Please try again." retry={()=>void withdrawals.refetch()}/>:recentWithdrawals.length?recentWithdrawals.map((row,i)=><FinanceRow key={asString(row,"id")??String(i)} icon={<ArrowUpRight color={palette.brand} size={17}/>} title="Wallet withdrawal" subtitle={(asString(row,"public_reference")??"Withdrawal")+" · "+statusName(asString(row,"status")??"pending")} amount={money(asNumber(row,"amount")??0,asString(row,"currency_code")??currency)}/>):<State title="No withdrawals yet" body="Completed and pending withdrawals will appear here."/>}</View>
 </Page>;
}

export function BillsTopUpScreen({onBack}:{onBack:()=>void}){
 const {session,supabase}=useSession();const {palette}=useAppTheme();
 const wallets=useBillsQuery(["wallets"],"/runtime/wallets",BillArraySchema,true,30000);
 const [amount,setAmount]=useState("");const [walletId,setWalletId]=useState("");const [previewData,setPreviewData]=useState<Row|null>(null);
 const [notice,setNotice]=useState("");const [depositKey,setDepositKey]=useState(()=>makeIdempotencyKey("bills-deposit"));const [pending,setPending]=useState(false);
 const wallet=useMemo(()=>{const owner=session?.user.id;return (wallets.data??[]).find(w=>asString(w,"wallet_type","walletType")==="customer"&&asString(w,"owner_entity_type","ownerEntityType")==="user"&&asString(w,"owner_entity_id","ownerEntityId")===owner&&![ "closed","disabled" ].includes((asString(w,"status")??"").toLowerCase()))??null;},[wallets.data,session?.user.id]);
 useEffect(()=>{const id=asString(wallet,"id","wallet_id","walletId");if(id)setWalletId(id);},[wallet]);
 const preview=useBillsFinanceMutation("/deposits/preview",actionSchema);
 const initialize=useBillsFinanceMutation("/deposits",actionSchema);
 const value=Number(amount);
 const valid=Number.isFinite(value)&&value>0;
 const fee=asNumber(previewData,"calculatedFeeAmount","calculated_fee_amount","feeAmount","fee_amount")??0;
 const charge=asNumber(previewData,"totalChargeAmount","total_charge_amount")??value+fee;
 const openCheckout=async(url:string)=>{try{if(url.startsWith("https://"))await WebBrowser.openBrowserAsync(url);else await Linking.openURL(url);}catch{setNotice("The payment page could not be opened. Your deposit request remains available in funding activity.");}};
 const prepare=async()=>{
  if(!valid||pending)return;setPending(true);setNotice("");
  try{
   let currentWalletId=walletId;
   if(!currentWalletId){
    const result=await supabase.rpc("ensure_wallet_account",{target_wallet_type:"customer",target_owner_entity_type:"user",target_owner_entity_id:session?.user.id,target_currency_code:"NGN",target_source:"platform.finance_runtime",target_metadata:{wallet_purpose:"customer_deposit"},target_idempotency_key:makeIdempotencyKey("bills-wallet")});
    if(result.error)throw result.error;currentWalletId=String(result.data);setWalletId(currentWalletId);
   }
   const quote=await preview.mutateAsync({walletId:currentWalletId,amount:value});setPreviewData(quote as Row);
  }catch(error){setNotice(error instanceof Error?error.message:"Deposit fee could not be calculated.");}
  finally{setPending(false);}
 };
 const confirm=async()=>{
  if(!walletId||!valid)return;setPending(true);setNotice("");
  try{
   const result=await initialize.mutateAsync({walletId,amount:value,idempotencyKey:depositKey,metadata:{channel:"skima-bills-mobile"}});
   const url=asString(result as Row,"authorizationUrl","authorization_url","checkout_url");
   if(url){await openCheckout(url);}
   else setNotice("Your funding request was initialized. The provider has not returned a hosted checkout URL. Check funding activity for status.");
   setPreviewData(null);setAmount("");setDepositKey(makeIdempotencyKey("bills-deposit"));
  }catch(error){setNotice(error instanceof Error?error.message:"Wallet funding could not be initialized.");}
  finally{setPending(false);}
 };
 return <Page>
  <SectionTitle title="Add funds" caption="Top up the same SKIMA customer wallet used across all SKIMA apps."/>
  <Card><View style={{flexDirection:"row",alignItems:"center",gap:8}}><WalletCards color={palette.brand} size={18}/><Text style={{fontSize:12,fontWeight:"900",color:palette.ink}}>Shared customer wallet · NGN</Text></View>
   <AppField label="Amount to add" value={amount} onChangeText={v=>{setAmount(v);setPreviewData(null);setDepositKey(makeIdempotencyKey("bills-deposit"));}} keyboardType="decimal-pad" placeholder="e.g. 5000"/>
   {previewData?<View style={{gap:8,backgroundColor:palette.surfaceSubtle,padding:12,borderRadius:14}}><FinanceSummary label="Wallet credit" value={money(value,"NGN")}/><FinanceSummary label="Funding fee" value={money(fee,"NGN")}/><FinanceSummary label="Total payment" value={money(charge,"NGN")} strong/></View>:null}
   {notice?<Notice tone="error" text={notice}/>:null}
   <AppButton label={previewData?"Continue to secure payment":"Review funding fee"} fullWidth disabled={!valid} loading={pending||preview.isPending||initialize.isPending} onPress={()=>void(previewData?confirm():prepare())}/>
   <Text style={{fontSize:10,color:palette.muted,lineHeight:15}}>Payment processing and wallet credit are handled by SKIMA's finance runtime. This app does not create a separate balance.</Text>
  </Card>
  <ActionButton label="Back to wallet" variant="quiet" onPress={onBack}/>
 </Page>;
}

export function BillsWithdrawScreen({onBack}:{onBack:()=>void}){
 const {session}=useSession();const {palette}=useAppTheme();
 const wallets=useBillsQuery(["wallets"],"/runtime/wallets",BillArraySchema,true,30000);
 const balances=useBillsQuery(["wallet-balances"],"/runtime/wallet-balances",BillArraySchema,true,20000);
 const banks=useBillsFinanceQuery({key:["banks"],path:"/banks",schema:bankSchema});
 const beneficiaries=useBillsFinanceQuery({key:["beneficiaries"],path:"/beneficiaries",schema:BillArraySchema});
 const [amount,setAmount]=useState("");const [beneficiaryId,setBeneficiaryId]=useState("");const [previewData,setPreviewData]=useState<Row|null>(null);const [notice,setNotice]=useState("");
 const [bankCode,setBankCode]=useState("");const [accountNumber,setAccountNumber]=useState("");const [showAdd,setShowAdd]=useState(false);const [pending,setPending]=useState(false);const [beneficiaryKey,setBeneficiaryKey]=useState(()=>makeIdempotencyKey("bills-beneficiary"));const [withdrawalKey,setWithdrawalKey]=useState(()=>makeIdempotencyKey("bills-withdrawal"));
 const wallet=(wallets.data??[]).find(w=>asString(w,"wallet_type","walletType")==="customer"&&asString(w,"owner_entity_type","ownerEntityType")==="user"&&asString(w,"owner_entity_id","ownerEntityId")===session?.user.id&&![ "closed","disabled" ].includes((asString(w,"status")??"").toLowerCase()))??null;
 const walletId=asString(wallet,"id","wallet_id","walletId");const currency=asString(wallet,"currency_code","currencyCode")??"NGN";const balanceRow=(balances.data??[]).find(row=>asString(row,"wallet_id","walletId","id")===walletId);const balance=asNumber(balanceRow,"available_balance","availableBalance","balance")??asNumber(wallet,"available_balance","availableBalance","balance")??0;
 const beneficiaryMutation=useBillsFinanceMutation("/beneficiaries",actionSchema);const preview=useBillsFinanceMutation("/withdrawals/preview",actionSchema);const withdraw=useBillsFinanceMutation("/withdrawals",actionSchema);
 const bankOptions=(banks.data as Row|undefined)?.banks as Row[]|undefined;
 const selectedBanks=Array.isArray(bankOptions)?bankOptions:[];
 const walletBeneficiaries=(beneficiaries.data??[]).filter(row=>asString(row,"wallet_id","walletId")===walletId);
 const verifiedBeneficiaries=walletBeneficiaries.filter(row=>asString(row,"status")==="verified");
 const value=Number(amount);const valid=currency==="NGN"&&Number.isFinite(value)&&value>0&&value<=balance;
 const bankCodeValid=selectedBanks.some(bank=>asString(bank,"code","bank_code","bankCode")===bankCode);
 const accountNumberValid=/^\\d{10}$/.test(accountNumber.trim());
 const canAddBeneficiary=Boolean(walletId&&currency==="NGN"&&bankCodeValid&&accountNumberValid);
 const canRequestWithdrawal=Boolean(walletId&&currency==="NGN"&&verifiedBeneficiaries.some(row=>asString(row,"id")===beneficiaryId)&&valid);
 const fee=asNumber(previewData,"calculatedFeeAmount","calculated_fee_amount")??0;const totalDebit=asNumber(previewData,"totalDebitAmount","total_debit_amount")??value+fee;
 const addBeneficiary=async()=>{
  if(!canAddBeneficiary||pending)return;setPending(true);setNotice("");
  try{const result=await beneficiaryMutation.mutateAsync({walletId,bankCode,accountNumber:accountNumber.trim(),idempotencyKey:beneficiaryKey,metadata:{channel:"skima-bills-mobile"}});setBeneficiaryId(asString(result as Row,"id")??"");setBeneficiaryKey(makeIdempotencyKey("bills-beneficiary"));setAccountNumber("");setShowAdd(false);await beneficiaries.refetch();}
  catch(error){setNotice(error instanceof Error?error.message:"Bank account could not be verified.");}
  finally{setPending(false);}
 };
 const prepare=async()=>{
  if(!canRequestWithdrawal||pending)return;setPending(true);setNotice("");
  try{const data=await preview.mutateAsync({walletId,amount:value});setPreviewData(data as Row);}
  catch(error){setNotice(error instanceof Error?error.message:"Withdrawal fee could not be calculated.");}
  finally{setPending(false);}
 };
 const confirm=async()=>{
  if(!canRequestWithdrawal||pending)return;setPending(true);setNotice("");
  try{await withdraw.mutateAsync({walletId,beneficiaryId,amount:value,idempotencyKey:withdrawalKey,metadata:{channel:"skima-bills-mobile"}});setWithdrawalKey(makeIdempotencyKey("bills-withdrawal"));setNotice("Your withdrawal request has been submitted to SKIMA finance. Track its processing status in wallet activity.");setPreviewData(null);setAmount("");await wallets.refetch();}
  catch(error){setNotice(error instanceof Error?error.message:"Withdrawal could not be submitted.");}
  finally{setPending(false);}
 };
 return <Page>
  <SectionTitle title="Withdraw funds" caption="Send money from your shared SKIMA customer wallet to a verified bank account."/>
  {currency!=="NGN"?<Notice tone="warning" text="Bank withdrawals are currently available for NGN customer wallets. Your other SKIMA wallet balances remain shared and unchanged."/>:null}
  <Card style={{gap:12}}>
   <FinanceSummary label="Available balance" value={money(balance,currency)} strong/>
   <Text style={{fontSize:11,fontWeight:"900",color:palette.ink}}>Bank account</Text>
   {beneficiaries.isPending?<ActivityIndicator color={palette.brand}/>:beneficiaries.error?<Notice tone="error" text="Saved bank accounts could not be loaded."/>:walletBeneficiaries.length?walletBeneficiaries.map(row=>{const id=asString(row,"id")??"";const verified=asString(row,"status")==="verified";return <Pressable key={id} disabled={!verified||pending} onPress={()=>{setBeneficiaryId(id);setWithdrawalKey(makeIdempotencyKey("bills-withdrawal"));setPreviewData(null);}} style={[styles.beneficiary,{borderColor:beneficiaryId===id?palette.brand:palette.border,backgroundColor:beneficiaryId===id?palette.brandSoft:palette.surfaceSubtle,opacity:verified?1:.58}]}><Building2 color={palette.brand} size={17}/><View style={{flex:1,gap:2}}><Text style={{color:palette.ink,fontSize:11,fontWeight:"900"}}>{asString(row,"account_name")??"Bank account"}</Text><Text style={{color:palette.muted,fontSize:10}}>{asString(row,"bank_code")??""} · •••• {asString(row,"account_number_last4")??"••••"}</Text></View><Text style={{fontSize:10,fontWeight:"900",color:verified?palette.success:palette.warning}}>{statusName(asString(row,"status")??"pending")}</Text></Pressable>;}) : <Notice text="Add a bank account to receive withdrawals." tone="warning"/>}
   <ActionButton label={showAdd?"Close bank form":"Add bank account"} variant="secondary" small onPress={()=>setShowAdd(!showAdd)}/>
   {showAdd?<View style={{gap:10}}><Field label="Select bank code" value={bankCode} onChangeText={v=>{setBankCode(v);setBeneficiaryKey(makeIdempotencyKey("bills-beneficiary"));}} placeholder="Choose a bank code"/><View style={{flexDirection:"row",flexWrap:"wrap",gap:6}}>{selectedBanks.slice(0,12).map((bank,i)=><Pressable key={asString(bank,"code")??String(i)} onPress={()=>{setBankCode(asString(bank,"code","bank_code","bankCode")??"");setBeneficiaryKey(makeIdempotencyKey("bills-beneficiary"));}} style={[styles.bankChip,{borderColor:bankCode===asString(bank,"code")?palette.brand:palette.border,backgroundColor:bankCode===asString(bank,"code")?palette.brandSoft:palette.surfaceSubtle}]}><Text style={{fontSize:10,color:palette.ink,fontWeight:"800"}}>{asString(bank,"name")??asString(bank,"display_name")??"Bank"}</Text></Pressable>)}</View><AppField label="Account number" value={accountNumber} onChangeText={v=>{setAccountNumber(v.replace(/\\D/g,"").slice(0,10));setBeneficiaryKey(makeIdempotencyKey("bills-beneficiary"));}} keyboardType="numeric" placeholder="10-digit account number"/><AppButton label="Verify and save bank" fullWidth disabled={!canAddBeneficiary} loading={pending||beneficiaryMutation.isPending} onPress={()=>void addBeneficiary()}/></View>:null}
   <AppField label="Amount to withdraw" value={amount} onChangeText={v=>{setAmount(v);setPreviewData(null);setWithdrawalKey(makeIdempotencyKey("bills-withdrawal"));}} keyboardType="decimal-pad" placeholder="0.00"/>
   {!valid&&amount.trim()?<Text style={{color:palette.danger,fontSize:10}}>Enter an amount up to your available balance.</Text>:null}
   {previewData?<View style={{gap:8,backgroundColor:palette.surfaceSubtle,borderRadius:14,padding:12}}><FinanceSummary label="Withdrawal amount" value={money(value,currency)}/><FinanceSummary label="Fee" value={money(fee,currency)}/><FinanceSummary label="Total wallet debit" value={money(totalDebit,currency)} strong/></View>:null}
   {notice?<Notice text={notice} tone={notice.startsWith("Your withdrawal")?"success":"error"}/>:null}
   <AppButton label={previewData?"Confirm withdrawal":"Review withdrawal"} fullWidth disabled={!canRequestWithdrawal||Boolean(pending)} loading={pending||preview.isPending||withdraw.isPending} onPress={()=>void(previewData?confirm():prepare())}/>
  </Card>
  <ActionButton label="Back to wallet" variant="quiet" onPress={onBack}/>
 </Page>;
}

function FinanceSummary({label,value,strong=false}:{label:string;value:string;strong?:boolean}){const {palette}=useAppTheme();return <View style={{flexDirection:"row",justifyContent:"space-between",gap:8}}><Text style={{fontSize:11,color:palette.muted}}>{label}</Text><Text style={{fontSize:11,color:palette.ink,fontWeight:strong?"900":"700"}}>{value}</Text></View>;}
function FinanceRow({icon,title,subtitle,amount}:{icon:any;title:string;subtitle:string;amount:string}){const {palette}=useAppTheme();return <Card style={{flexDirection:"row",alignItems:"center",gap:9}}><View style={[styles.icon,{backgroundColor:palette.brandSoft}]}>{icon}</View><View style={{flex:1,gap:3}}><Text style={{fontSize:11,color:palette.ink,fontWeight:"900"}}>{title}</Text><Text style={{fontSize:10,color:palette.muted}}>{subtitle}</Text></View><Text style={{fontSize:11,color:palette.ink,fontWeight:"900"}}>{amount}</Text></Card>;}
const styles=StyleSheet.create({icon:{width:37,height:37,borderRadius:12,alignItems:"center",justifyContent:"center"},beneficiary:{minHeight:57,borderWidth:1,borderRadius:14,padding:10,flexDirection:"row",alignItems:"center",gap:8},bankChip:{paddingHorizontal:9,paddingVertical:7,borderWidth:1,borderRadius:11}});
