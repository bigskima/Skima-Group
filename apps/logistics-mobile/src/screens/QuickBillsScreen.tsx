import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { ArrowRight, Receipt } from "lucide-react-native";
import { useLogisticsQuery, asString } from "../api/logistics";
import { useAppTheme } from "../theme/ThemeProvider";
import { Screen } from "../ui/Screen";
import { StatePanel } from "../ui/StatePanel";
import { AppButton } from "../ui/AppButton";

export function QuickBillsScreen(){
 const {palette}=useAppTheme();
 const [openNotice,setOpenNotice]=useState("");
 const [activeSection,setActiveSection]=useState<"overview"|"services">("overview");
 const catalog=useLogisticsQuery(["utility","catalog"],"/runtime/utility-billing/catalog",true,60000);
 const groups=[...new Map((catalog.data??[]).filter(row=>row.available===true).map(row=>[asString(row,"category_key")??"other",asString(row,"category_name")??"More services"])).entries()];
 const open=async()=>{
  setOpenNotice("");
  const base=process.env.EXPO_PUBLIC_SKIMA_BILLS_BASE_URL?.trim();
  if(Platform.OS==="web"&&base){try{await Linking.openURL(base);return;}catch{}}
  try{await Linking.openURL("skima-bills://");return;}catch{}
  if(base){try{await Linking.openURL(base);return;}catch{}}
  setOpenNotice("Open bills.skima.online in your browser to continue.");
 };
 return <Screen title="Bills" eyebrow="Everyday services" subtitle="Choose a group, then continue in the dedicated Bills workspace.">
  <View style={{flexDirection:"row",gap:8}}>{([["overview","Overview"],["services","Bill services"]] as const).map(([key,label])=>{const active=activeSection===key;return <Pressable key={key} accessibilityRole="button" accessibilityState={{selected:active}} onPress={()=>setActiveSection(key)} style={{flex:1,minHeight:42,alignItems:"center",justifyContent:"center",borderRadius:13,borderWidth:1,borderColor:active?palette.brand:palette.border,backgroundColor:active?palette.brandSoft:palette.surface}}><Text style={{color:active?palette.brand:palette.ink,fontSize:10,fontWeight:"900"}}>{label}</Text></Pressable>;})}</View>
  {activeSection==="overview"?<View style={{padding:17,borderRadius:20,backgroundColor:palette.brand,gap:9}}>
   <Receipt color="#fff" size={24}/>
   <Text style={{fontSize:22,color:"#fff",fontWeight:"900"}}>Pay bills with SKIMA</Text>
   <Text style={{fontSize:11,color:"rgba(255,255,255,.86)",lineHeight:17}}>Pay supported bills, save frequent billers and view your receipts and payment history.</Text>
   <AppButton label="Open SKIMA Bills" onPress={()=>void open()}/>
   {openNotice?<Text accessibilityRole="alert" style={{fontSize:10,color:"#fff",lineHeight:15}}>{openNotice}</Text>:null}
  </View>:null}
  {activeSection==="services"?<View style={{gap:8}}>
   <Text style={{fontSize:14,fontWeight:"900",color:palette.ink}}>Services available</Text>
   <Text style={{fontSize:10,color:palette.muted}}>Choose from the bill services available below.</Text>
   {catalog.isPending?<StatePanel title="Loading services" description="Loading bill services."/>:catalog.error?<StatePanel title="Services unavailable" description="Try again to reload bill services." retry={()=>void catalog.refetch()}/>:groups.length?groups.map(([key,name])=><Pressable key={key} onPress={()=>void open()} accessibilityRole="button" style={{minHeight:49,padding:11,borderRadius:14,backgroundColor:palette.surface,borderColor:palette.border,borderWidth:StyleSheet.hairlineWidth,flexDirection:"row",alignItems:"center",gap:9}}><Receipt color={palette.brand} size={16}/><Text style={{flex:1,fontSize:11,fontWeight:"900",color:palette.ink}}>{name}</Text><ArrowRight color={palette.muted} size={15}/></Pressable>):<StatePanel title="No bill services available" description="Please check again later."/>}
  </View>:null}
 </Screen>;
}
