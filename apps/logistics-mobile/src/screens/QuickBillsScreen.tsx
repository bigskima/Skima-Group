import { Linking, Pressable, Text, View } from "react-native";
import { ArrowRight, Receipt } from "lucide-react-native";
import { useLogisticsQuery, asString } from "../api/logistics";
import { useAppTheme } from "../theme/ThemeProvider";
import { Page, Card, SectionTitle, ActionButton, State } from "./BillsUI";

export function BillsQuickEntry(){
 const {palette}=useAppTheme();
 const catalog=useLogisticsQuery(["utility","catalog"],"/runtime/utility-billing/catalog",true,60000);
 const groups=[...new Map((catalog.data??[]).filter(row=>row.available===true).map(row=>[asString(row,"category_key")??"other",asString(row,"category_name")??"More services"])).entries()];
 const open=async()=>{
  try{await Linking.openURL("skima-bills://");return;}catch{}
  const base=process.env.EXPO_PUBLIC_SKIMA_BILLS_BASE_URL?.trim();
  if(base){try{await Linking.openURL(base);return;}catch{}}
 };
 return <Page>
  <Card style={{backgroundColor:palette.brand,borderColor:palette.brand,padding:17}}>
   <Receipt color="#fff" size={24}/><Text style={{fontSize:22,color:"#fff",fontWeight:"900"}}>Pay bills with SKIMA</Text><Text style={{fontSize:11,color:"rgba(255,255,255,.86)",lineHeight:17}}>A dedicated Bills experience for payments, saved billers, shared wallet, receipts and Store purchases.</Text>
   <ActionButton label="Open SKIMA Bills" onPress={()=>void open()}/>
  </Card>
  <SectionTitle title="Services available" caption="Live products configured by SKIMA Admin."/>
  {catalog.isPending?<State title="Loading services" body="Checking the active utility catalogue."/>:catalog.error?<State title="Services unavailable" body="Try again to reload the SKIMA service catalogue." retry={()=>void catalog.refetch()}/>:groups.length?<View style={{gap:8}}>{groups.map(([key,name])=><Card key={key} style={{flexDirection:"row",alignItems:"center",gap:9}}><View style={{width:35,height:35,borderRadius:12,backgroundColor:palette.brandSoft,alignItems:"center",justifyContent:"center"}}><Receipt color={palette.brand} size={17}/></View><Text style={{flex:1,fontSize:11,fontWeight:"900",color:palette.ink}}>{name}</Text><ArrowRight color={palette.muted} size={16}/></Card>)}</View>:<State title="No utility services enabled" body="Services will appear once activated in SKIMA Admin."/>}
  <Text style={{fontSize:10,color:palette.muted,lineHeight:15}}>Bills opened from Logistics continues to use the same SKIMA customer account and wallet. Your delivery workspace remains unchanged.</Text>
 </Page>;
}
