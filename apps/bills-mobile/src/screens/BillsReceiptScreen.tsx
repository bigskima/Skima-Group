import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Share, Text, View } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { CheckCircle2, Receipt, Share2, ShieldCheck } from "lucide-react-native";
import { useBillsQuery, BillArraySchema, asNumber, asString, money } from "../api/bills";
import { useAppTheme } from "../theme/ThemeProvider";
import { Page, Card, SectionTitle, ActionButton, State, Notice } from "./BillsUI";

function escapeHtml(value:string){return value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]??c));}
export function BillsReceiptScreen({id}:{id:string}){
 const {palette}=useAppTheme();const [busy,setBusy]=useState(false);const [notice,setNotice]=useState("");
 const query=useBillsQuery(["utility","requests"],"/runtime/utility-billing/requests",BillArraySchema,true,15000);
 const bill=useMemo(()=>query.data?.find(row=>asString(row,"id")===id)??null,[query.data,id]);
 const currency=asString(bill,"currency_code")??"NGN";
 const rows=[
  ["Service",asString(bill,"product_name","biller_name")??"Utility payment"],
  ["Customer account",asString(bill,"customer_identifier")??"—"],
  ["Amount",money(asNumber(bill,"subtotal_amount","amount")??0,currency)],
  ["Discount",money(asNumber(bill,"discount_amount")??0,currency)],
  ["Service fee",money(asNumber(bill,"fee_amount")??0,currency)],
  ["Total",money(asNumber(bill,"total_amount","total_debit_amount")??0,currency)],
  ["Provider reference",asString(bill,"provider_reference")??"Not yet available"],
  ["Payment reference",asString(bill,"public_reference")??id],
  ["Requested",asString(bill,"created_at")?new Date(asString(bill,"created_at")!).toLocaleString("en-NG"):"—"],
 ];
 const share=async()=>{
  if(!bill)return;setBusy(true);
  try{
   const html=`<html><body style="font-family:Arial,sans-serif;padding:28px;color:#19191b"><h2>SKIMA Bills receipt</h2><p style="color:#707078">Payment record</p><h1>${escapeHtml(rows[5][1])}</h1><p>${escapeHtml(rows[7][1])}</p><hr/>${rows.map(([k,v])=>`<p><small style="color:#707078">${escapeHtml(k)}</small><br/><b>${escapeHtml(v)}</b></p>`).join("")}<hr/><p style="font-size:11px;color:#707078">This receipt reflects the bill request status recorded by SKIMA. Provider confirmation remains authoritative.</p></body></html>`;
   const file=await Print.printToFileAsync({html});
   if(await Sharing.isAvailableAsync())await Sharing.shareAsync(file.uri,{mimeType:"application/pdf",dialogTitle:"Share SKIMA Bills receipt"});
   else await Share.share({message:"SKIMA Bills receipt "+rows[7][1]+" · "+rows[5][1]});
  }catch(error){setNotice(error instanceof Error?error.message:"Receipt could not be exported.");}
  finally{setBusy(false);}
 };
 return <Page>
  <SectionTitle title="Bill receipt" caption="A clear record of the request and provider outcome."/>
  {query.isPending?<ActivityIndicator color={palette.brand}/>:query.error?<State title="Receipt unavailable" body="Your receipt could not be loaded. Try refreshing." retry={()=>void query.refetch()}/>:!bill?<State title="Receipt not found" body="This bill request is not present in your visible history."/>:<>
   <Card style={{alignItems:"center",gap:8,paddingVertical:22}}>
    <View style={{width:50,height:50,borderRadius:17,backgroundColor:palette.brandSoft,alignItems:"center",justifyContent:"center"}}><Receipt color={palette.brand} size={23}/></View>
    <Text style={{fontSize:10,color:palette.muted,fontWeight:"900",letterSpacing:1}}>SKIMA BILLS</Text>
    <Text style={{fontSize:26,color:palette.ink,fontWeight:"900"}}>{rows[5][1]}</Text>
    <Text style={{fontSize:10,color:palette.muted}}>{rows[7][1]}</Text>
    <View style={{flexDirection:"row",alignItems:"center",gap:5,marginTop:4}}><CheckCircle2 color={/success|complete|fulfilled/i.test(asString(bill,"status")??"")?palette.success:palette.warning} size={15}/><Text style={{fontSize:11,fontWeight:"900",color:palette.ink}}>{(asString(bill,"status")??"pending").replaceAll("_"," ").toUpperCase()}</Text></View>
   </Card>
   <Card>{rows.map(([label,value],index)=><View key={label} style={{paddingVertical:10,borderTopWidth:index?0.5:0,borderTopColor:palette.border,gap:4}}><Text style={{fontSize:9,color:palette.muted,fontWeight:"700"}}>{label}</Text><Text selectable style={{fontSize:12,color:palette.ink,fontWeight:label==="Total"?"900":"700"}}>{value}</Text></View>)}</Card>
   <ActionButton label="Export / share receipt (PDF)" onPress={()=>void share()} loading={busy}/>
   {notice?<Notice text={notice} tone="error"/>:null}
   <Notice text="The receipt reflects the current provider status. Pending requests are not treated as successful purchases." tone="info"/>
  </>}
 </Page>;
}
