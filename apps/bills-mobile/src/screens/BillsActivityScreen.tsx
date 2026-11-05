import { Pressable, RefreshControl, Text, View } from "react-native";
import { ChevronRight, Receipt, Clock3 } from "lucide-react-native";
import { useBillsQuery, BillArraySchema, asString, asNumber, money } from "../api/bills";
import { useAppTheme } from "../theme/ThemeProvider";
import { Page, Card, SectionTitle, State } from "./BillsUI";
import { GuideTarget } from "../onboarding/BillsGuideProvider";

export function BillsActivityScreen({onReceipt}:{onReceipt:(id:string)=>void}){
 const {palette}=useAppTheme();
 const query=useBillsQuery(["utility","requests"],"/runtime/utility-billing/requests",BillArraySchema,true,15000);
 const rows=query.data??[];
 return <Page guidePage="activity" refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={()=>void query.refetch()} tintColor={palette.brand}/>}>
  <GuideTarget page="activity" targetKey="bills.activity.history"><SectionTitle title="Bill activity" caption="Every bill request, provider update and reversal in one place."/></GuideTarget>
  {query.isPending?<State title="Loading bill activity" body="Retrieving your SKIMA utility payment records."/>:query.error?<State title="Activity unavailable" body="Your payment records are safe. Try again." retry={()=>void query.refetch()}/>:!rows.length?<State title="No bill payments yet" body="Your successful and pending utility payments will appear here."/>:<>
   <Card><Text style={{fontSize:12,fontWeight:"900",color:palette.ink}}>{rows.length} bill requests</Text>{rows.map((row,i)=>{const id=asString(row,"id");const currency=asString(row,"currency_code")??"NGN";return <Pressable key={id??String(i)} disabled={!id} onPress={()=>id&&onReceipt(id)} style={{minHeight:66,flexDirection:"row",alignItems:"center",gap:10,borderTopWidth:i?0.5:0,borderTopColor:palette.border,paddingVertical:10}}>
    <View style={{width:39,height:39,borderRadius:13,backgroundColor:palette.brandSoft,alignItems:"center",justifyContent:"center"}}><Receipt color={palette.brand} size={18}/></View>
    <View style={{flex:1,minWidth:0,gap:3}}><Text numberOfLines={1} style={{fontSize:11,fontWeight:"900",color:palette.ink}}>{asString(row,"product_name","biller_name")??"Utility payment"}</Text><Text numberOfLines={1} style={{fontSize:9,color:palette.muted}}>{asString(row,"public_reference")??"Bill request"} · {asString(row,"customer_identifier")??"Account"}</Text><View style={{flexDirection:"row",alignItems:"center",gap:4}}><Clock3 size={11} color={palette.muted}/><Text style={{fontSize:9,color:palette.muted}}>{asString(row,"created_at")?new Date(asString(row,"created_at")!).toLocaleString("en-NG"):""}</Text></View></View>
    <View style={{alignItems:"flex-end",gap:4}}><Text style={{fontSize:11,fontWeight:"900",color:palette.ink}}>{money(asNumber(row,"total_amount","subtotal_amount","amount")??0,currency)}</Text><Text style={{fontSize:9,color:statusColor(asString(row,"status")??"pending",palette),fontWeight:"900"}}>{(asString(row,"status")??"pending").replaceAll("_"," ")}</Text></View><ChevronRight color={palette.muted} size={15}/>
   </Pressable>;})}</Card>
  </>}
 </Page>;
}
function statusColor(status:string,palette:ReturnType<typeof useAppTheme>["palette"]){const v=status.toLowerCase();if(/success|complete|fulfilled/.test(v))return palette.success;if(/fail|revers|cancel/.test(v))return palette.danger;return palette.warning;}
