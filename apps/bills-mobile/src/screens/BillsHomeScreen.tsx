import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronRight, Gift, Phone, Receipt, WalletCards, Wifi, Zap } from "lucide-react-native";
import { z } from "zod";
import { useBillsMutation, useBillsQuery, BillArraySchema, asNumber, asString, money, makeIdempotencyKey } from "../api/bills";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { Page, Card, SectionTitle, ActionButton, State, Notice } from "./BillsUI";
import { AppField } from "../ui/AppField";
import { AppModal } from "../ui/AppModal";
import { AppButton } from "../ui/AppButton";
type Row=Record<string,unknown>;
type Group={key:string;name:string;icon:string;products:Row[]};
const ValidationSchema=z.record(z.string(),z.unknown());
const PaymentIdSchema=z.string().uuid();
function iconFor(key:string,color:string,size=18){if(/electric|power|prepaid|zap/i.test(key))return <Zap color={color} size={size}/>;if(/data|internet|wifi/i.test(key))return <Wifi color={color} size={size}/>;if(/airtime|phone/i.test(key))return <Phone color={color} size={size}/>;return <Receipt color={color} size={size}/>;}
function groupProducts(rows:Row[]):Group[]{const map=new Map<string,Group>();for(const item of rows){const key=asString(item,"category_key")??"other";const group=map.get(key)??{key,name:asString(item,"category_name")??"More services",icon:asString(item,"icon_key")??"receipt",products:[]};group.products.push(item);map.set(key,group);}return [...map.values()];}
export function BillsHomeScreen({onOpenPage,onReceipt}:{onOpenPage:(page:any)=>void;onReceipt:(id:string)=>void}){
 const {session}=useSession();const {palette}=useAppTheme();
 const catalog=useBillsQuery(["utility","catalog"],"/runtime/utility-billing/catalog",BillArraySchema,true,60000);
 const offers=useBillsQuery(["utility","offers"],"/runtime/utility-billing/offers",BillArraySchema,true,60000);
 const requests=useBillsQuery(["utility","requests"],"/runtime/utility-billing/requests",BillArraySchema,true,20000);
 const wallets=useBillsQuery(["wallets"],"/runtime/wallet-balances",BillArraySchema,true,30000);
 const [category,setCategory]=useState("");const [product,setProduct]=useState<Row|null>(null);
 const [identifier,setIdentifier]=useState("");const [amount,setAmount]=useState("");const [phone,setPhone]=useState("");const [promo,setPromo]=useState("");
 const [validated,setValidated]=useState("");const [validationResult,setValidationResult]=useState<Row|null>(null);
 const [showOptional,setShowOptional]=useState(false);const [notice,setNotice]=useState("");const [noticeSuccess,setNoticeSuccess]=useState(false);
 const validate=useBillsMutation("/runtime/utility-billing/validate",ValidationSchema);
 const pay=useBillsMutation("/runtime/utility-billing/requests",PaymentIdSchema,[["utility","requests"],["wallets"]]);
 const groups=useMemo(()=>groupProducts(catalog.data??[]),[catalog.data]);
 const active=groups.find(group=>group.key===category)??groups[0]??null;
 const userId=session?.user.id??"";
 useEffect(()=>{
  if(!userId||!catalog.data)return;
  let active=true;
  const key="skima:bills:pending-beneficiary:"+userId;
  void AsyncStorage.getItem(key).then(async raw=>{
   if(!active||!raw)return;
   let saved:Row;
   try{saved=JSON.parse(raw) as Row;}catch{await AsyncStorage.removeItem(key);return;}
   const target=catalog.data?.find(row=>asString(row,"product_id")===asString(saved,"productId"));
   if(target&&target.available===true){
    setProduct(target);setIdentifier(asString(saved,"customerIdentifier")??"");setPhone(asString(saved,"recipientPhone")??"");
    setValidated("");setValidationResult(null);setShowOptional(true);
    setNotice("Saved details loaded for "+(asString(saved,"displayName")??"your biller")+". Review and validate before paying.");setNoticeSuccess(false);
   }else{setNotice("This saved service is currently unavailable. Choose another active option.");setNoticeSuccess(false);}
   await AsyncStorage.removeItem(key);
  }).catch(()=>undefined);
  return()=>{active=false;};
 },[userId,catalog.data]);
 const currencySelected=asString(product,"currency_code","currencyCode")??"NGN";
 const wallet=(wallets.data??[]).find(w=>asString(w,"wallet_type","walletType")==="customer"&&asString(w,"owner_entity_type","ownerEntityType")==="user"&&asString(w,"owner_entity_id","ownerEntityId")===userId&&(asString(w,"currency_code","currencyCode")??"NGN")===currencySelected&&![ "closed","disabled" ].includes((asString(w,"status")??"").toLowerCase()))??null;
 const walletId=asString(wallet,"wallet_id","walletId","id");
 const currency=asString(wallet,"currency_code","currencyCode")??currencySelected;
 const balance=asNumber(wallet,"available_balance","availableBalance","balance")??0;
 const fixed=asNumber(product,"fixed_amount","fixedAmount");const min=asNumber(product,"minimum_amount","minimumAmount");const max=asNumber(product,"maximum_amount","maximumAmount");
 const amountValue=fixed??(amount.trim()?Number(amount):0);const amountValid=Number.isFinite(amountValue)&&amountValue>0;
 const feePercent=asNumber(product,"service_fee_percent","serviceFeePercent")??0;const feeFixed=asNumber(product,"service_fee_fixed","serviceFeeFixed")??0;
 const fee=amountValid?Math.max(0,amountValue*feePercent/100+feeFixed):0;const total=amountValue+fee;
 const amountError=amountValid?(min!==null&&amountValue<min?"Minimum "+money(min,currency)+".":max!==null&&amountValue>max?"Maximum "+money(max,currency)+".":total>balance?"Your available SKIMA Wallet balance is not enough.":null):(amount.trim()||fixed!==null?"Enter a valid amount greater than zero.":null);
 const canContinue=Boolean(product&&walletId&&identifier.trim()&&amountValid&&!amountError);
 const available=groups.reduce((sum,g)=>sum+g.products.filter(p=>p.available===true).length,0);
 const recent=(requests.data??[]).slice(0,3);
 const closePay=()=>{if(validate.isPending||pay.isPending)return;setProduct(null);setIdentifier("");setAmount("");setPhone("");setPromo("");setValidated("");setValidationResult(null);setShowOptional(false);};
 const pick=(item:Row,preFill="")=>{setProduct(item);setIdentifier(preFill);setAmount("");setPhone("");setPromo("");setValidated("");setValidationResult(null);setNotice("");};
 const submit=async()=>{
  if(!product||!canContinue)return;const productId=asString(product,"product_id");if(!productId||!walletId)return;
  if(validated!==identifier.trim()){
   try{const result=await validate.mutateAsync({productId,customerIdentifier:identifier.trim()});setValidated(identifier.trim());setValidationResult(result as Row);return;}
   catch(error){setValidated("");setValidationResult(null);setNotice(error instanceof Error?error.message:"Account details could not be validated.");setNoticeSuccess(false);return;}
  }
  try{
   await pay.mutateAsync({productId,walletId,customerIdentifier:identifier.trim(),amount:amountValue,recipientPhone:phone.trim()||undefined,promotionKey:promo.trim()||undefined,idempotencyKey:makeIdempotencyKey("bills-payment"),metadata:{channel:"skima-bills-mobile",customerValidated:true,validationSkipped:validationResult?.validationSkipped===true}});
   closePay();setNotice("Your bill request has been accepted. The amount is reserved in your shared SKIMA Wallet while the provider completes the service.");setNoticeSuccess(true);
  }catch(error){setNotice(error instanceof Error?error.message:"The bill payment could not be prepared. Please try again.");setNoticeSuccess(false);}
 };
 const refresh=()=>void Promise.all([catalog.refetch(),offers.refetch(),requests.refetch(),wallets.refetch()]);
 return <Page refreshControl={<RefreshControl refreshing={catalog.isRefetching||requests.isRefetching||wallets.isRefetching} onRefresh={refresh} tintColor={palette.brand}/>}>
  <View style={[styles.hero,{backgroundColor:palette.brand}]}>
   <View style={{flex:1,gap:6}}><Text style={styles.heroEyebrow}>EVERYDAY PAYMENTS</Text><Text style={styles.heroTitle}>Bills, made simpler.</Text><Text style={styles.heroBody}>Airtime, data, electricity, TV and more — in one secure place.</Text></View>
   <View style={styles.heroIcon}><Receipt color="#fff" size={27}/></View>
  </View>
  <View style={styles.walletRow}>
   <Card style={{flex:1,gap:4}}><View style={{flexDirection:"row",alignItems:"center",gap:7}}><WalletCards size={16} color={palette.brand}/><Text style={{fontSize:10,fontWeight:"900",color:palette.muted}}>SHARED WALLET</Text></View><Text style={{fontSize:22,fontWeight:"900",color:palette.ink}}>{money(balance,currency)}</Text><Text style={{fontSize:10,color:palette.muted}}>Same balance across Refill, Logistics and Bills</Text></Card>
   <ActionButton label="Add funds" small onPress={()=>onOpenPage("top-up")}/>
  </View>
  {offers.data?.length?<View style={{gap:9}}><SectionTitle title="Offers and savings" caption="Available offers configured by SKIMA"/><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:9}}>{offers.data.slice(0,6).map((offer,i)=><Card key={asString(offer,"offer_key")??String(i)} style={{width:205,flexDirection:"row",alignItems:"center",gap:9}}><View style={[styles.offerIcon,{backgroundColor:palette.brandSoft}]}><Gift color={palette.brand} size={18}/></View><View style={{flex:1,gap:2}}><Text style={{color:palette.brand,fontSize:11,fontWeight:"900"}}>{asString(offer,"value_label")??"Offer"}</Text><Text numberOfLines={2} style={{color:palette.ink,fontSize:11,fontWeight:"800"}}>{asString(offer,"offer_name")??"Bill offer"}</Text></View></Card>)}</ScrollView></View>:null}
  <View style={{gap:10}}>
   <SectionTitle title="Choose a service" caption={catalog.isPending?"Loading live services…":available+" payment options currently available"}/>
   {catalog.isPending?<View style={{padding:20,alignItems:"center"}}><ActivityIndicator color={palette.brand}/></View>:catalog.error?<State title="Bill services unavailable" body="We could not load the active SKIMA utility catalogue." retry={()=>void catalog.refetch()}/>:!groups.length?<State title="No services are enabled yet" body="Only services activated by SKIMA Admin will appear here."/>:<>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8,paddingBottom:2}}>{groups.map(group=>{const selected=group.key===active?.key;return <Pressable key={group.key} onPress={()=>setCategory(group.key)} style={[styles.category,{backgroundColor:selected?palette.brandSoft:palette.surface,borderColor:selected?palette.brand:palette.border}]}>{iconFor(group.icon,selected?palette.brand:palette.muted,16)}<Text style={{fontSize:11,fontWeight:"900",color:selected?palette.brand:palette.ink}}>{group.name}</Text></Pressable>;})}</ScrollView>
    {active?<View style={styles.productGrid}>{active.products.map((item,i)=>{const enabled=item.available===true;return <Pressable key={asString(item,"product_id")??String(i)} disabled={!enabled} onPress={()=>pick(item)} style={[styles.product,{backgroundColor:palette.surface,borderColor:palette.border,opacity:enabled?1:.48}]}><View style={[styles.productIcon,{backgroundColor:enabled?palette.brandSoft:palette.surfaceSubtle}]}>{iconFor(active.icon,enabled?palette.brand:palette.muted,19)}</View><View style={{flex:1,gap:3}}><Text numberOfLines={2} style={{fontSize:12,fontWeight:"900",color:palette.ink}}>{asString(item,"product_name")??"Bill payment"}</Text><Text style={{fontSize:10,fontWeight:"800",color:enabled?palette.brand:palette.muted}}>{enabled?"Pay now":"Unavailable"}</Text></View>{enabled?<ChevronRight size={17} color={palette.muted}/>:null}</Pressable>;})}</View>:null}
   </>}
  </View>
  <View style={{gap:10}}>
   <SectionTitle title="Recent bill activity" action={<ActionButton label="View all" variant="quiet" small onPress={()=>onOpenPage("activity")}/>}/>
   {requests.isPending?<ActivityIndicator color={palette.brand}/>:requests.error?<State title="Activity unavailable" body="Your payment records are safe. Try again shortly." retry={()=>void requests.refetch()}/>:recent.length?recent.map((row,i)=><Pressable key={asString(row,"id")??String(i)} onPress={()=>onReceipt(asString(row,"id")??"")}><Card style={{flexDirection:"row",alignItems:"center"}}><View style={[styles.productIcon,{backgroundColor:palette.brandSoft}]}><Receipt size={17} color={palette.brand}/></View><View style={{flex:1,gap:3}}><Text style={{fontSize:11,fontWeight:"900",color:palette.ink}}>{asString(row,"product_name","biller_name")??"Bill payment"}</Text><Text style={{fontSize:10,color:palette.muted}}>{asString(row,"public_reference")??asString(row,"customer_identifier")??"Request"} · {statusLabel(asString(row,"status")??"pending")}</Text></View><Text style={{fontSize:11,fontWeight:"900",color:palette.ink}}>{money(asNumber(row,"total_amount","subtotal_amount","amount")??0,asString(row,"currency_code")??"NGN")}</Text><ChevronRight size={16} color={palette.muted}/></Card></Pressable>):<State title="No bill payments yet" body="Your completed and pending utility payments will appear here."/>}
  </View>
  <View style={{flexDirection:"row",gap:9}}><ActionButton label="Saved billers" variant="secondary" small onPress={()=>onOpenPage("saved")}/><ActionButton label="Visit Store" variant="secondary" small onPress={()=>onOpenPage("store")}/></View>
  <AppModal visible={Boolean(product)} title={asString(product,"product_name")??"Pay bill"} description="Confirm the customer details before your payment is submitted." onClose={closePay}>
   <View style={[styles.summary,{backgroundColor:palette.surfaceSubtle,borderColor:palette.border}]}>
    <Row label="Wallet balance" value={money(balance,currency)}/>{fixed!==null?<Row label="Bill amount" value={money(fixed,currency)}/>:null}
    {amountValue>0&&fee>0?<Row label="Service fee" value={money(fee,currency)}/>:null}{amountValid?<Row label="Estimated total" value={money(total,currency)} strong/>:null}
   </View>
   <AppField label={asString(product,"customer_identifier_label")??"Account or phone number"} value={identifier} onChangeText={v=>{setIdentifier(v);setValidated("");setValidationResult(null);}} placeholder={asString(product,"customer_identifier_hint")??"Enter customer details"}/>
   {validationResult?<Notice text={(validationResult.validationSkipped===true?"Recipient details are ready. ":"Account validated. ")+(asString(validationResult,"customerName")??identifier)} tone="success"/>:null}
   {fixed===null?<AppField label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" error={amountError??undefined}/>:null}
   {amountError?<Text style={{color:palette.danger,fontSize:11,fontWeight:"700"}}>{amountError}</Text>:null}
   {showOptional?<><AppField label="Recipient phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad"/><AppField label="Promo code (optional)" value={promo} onChangeText={setPromo} autoCapitalize="none"/></>:<Pressable onPress={()=>setShowOptional(true)}><Text style={{color:palette.brand,fontSize:11,fontWeight:"900"}}>Add recipient phone or promo code</Text></Pressable>}
   <View style={{flexDirection:"row",gap:9}}><View style={{flex:1}}><AppButton label="Cancel" variant="secondary" fullWidth onPress={closePay}/></View><View style={{flex:1}}><AppButton label={validated===identifier.trim()?"Pay bill":"Validate details"} fullWidth disabled={!canContinue} loading={validate.isPending||pay.isPending} onPress={()=>void submit()}/></View></View>
  </AppModal>
  <AppModal visible={Boolean(notice)} title={noticeSuccess?"Payment request received":"Payment not completed"} description={notice} tone={noticeSuccess?"success":"danger"} onClose={()=>setNotice("")}><AppButton label="Done" onPress={()=>setNotice("")}/></AppModal>
 </Page>;
}
function Row({label,value,strong=false}:{label:string;value:string;strong?:boolean}){const {palette}=useAppTheme();return <View style={{flexDirection:"row",justifyContent:"space-between",gap:10}}><Text style={{color:palette.muted,fontSize:11}}>{label}</Text><Text style={{color:palette.ink,fontSize:11,fontWeight:strong?"900":"700"}}>{value}</Text></View>;}
function statusLabel(value:string){return value.replaceAll("_"," ").replace(/\b\w/g,m=>m.toUpperCase());}
const styles=StyleSheet.create({hero:{borderRadius:22,padding:18,minHeight:138,flexDirection:"row",alignItems:"center",gap:13},heroEyebrow:{color:"rgba(255,255,255,.78)",fontSize:9,fontWeight:"900",letterSpacing:1.3},heroTitle:{color:"#fff",fontSize:24,fontWeight:"900",letterSpacing:-.7},heroBody:{color:"rgba(255,255,255,.85)",fontSize:11,lineHeight:17,maxWidth:270},heroIcon:{width:54,height:54,borderRadius:18,backgroundColor:"rgba(255,255,255,.16)",alignItems:"center",justifyContent:"center"},walletRow:{flexDirection:"row",alignItems:"center",gap:9},offerIcon:{width:37,height:37,borderRadius:12,alignItems:"center",justifyContent:"center"},category:{minHeight:43,borderRadius:14,borderWidth:1,paddingHorizontal:12,flexDirection:"row",alignItems:"center",gap:7},productGrid:{flexDirection:"row",flexWrap:"wrap",gap:8},product:{width:"48.5%",minHeight:78,borderRadius:16,borderWidth:StyleSheet.hairlineWidth,padding:10,flexDirection:"row",alignItems:"center",gap:8},productIcon:{width:37,height:37,borderRadius:12,alignItems:"center",justifyContent:"center"},summary:{borderRadius:14,borderWidth:1,padding:12,gap:9}});
