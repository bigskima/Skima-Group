import { Linking, Platform, StyleSheet, Text, View } from "react-native";
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
 const catalog=useLogisticsQuery(["utility","catalog"],"/runtime/utility-billing/catalog",true,60000);
 const groups=[...new Map((catalog.data??[]).filter(row=>row.available===true).map(row=>[asString(row,"category_key")??"other",asString(row,"category_name")??"More services"])).entries()];
 const open=async()=>{
  setOpenNotice("");
  const base=process.env.EXPO_PUBLIC_SKIMA_BILLS_BASE_URL?.trim();
  if(Platform.OS==="web"&&base){try{await Linking.openURL(base);return;}catch{}}
  try{await Linking.openURL("skima-bills://");return;}catch{}
  if(base){try{await Linking.openURL(base);return;}catch{}}
  setOpenNotice("SKIMA Bills is not installed on this device and no Bills web host has been configured yet. Your Logistics workspace remains available.");
 };
 return <Screen title="Bills" eyebrow="Everyday services" subtitle="Reach the dedicated SKIMA Bills application and keep all payments on your shared customer account.">
  <View style={{padding:17,borderRadius:20,backgroundColor:palette.brand,gap:9}}>
   <Receipt color="#fff" size={24}/>
   <Text style={{fontSize:22,color:"#fff",fontWeight:"900"}}>Pay bills with SKIMA</Text>
   <Text style={{fontSize:11,color:"rgba(255,255,255,.86)",lineHeight:17}}>A dedicated Bills experience for service discovery, account validation, payments, saved billers, receipts and Store checkout.</Text>
   <AppButton label="Open SKIMA Bills" onPress={()=>void open()}/>
   {openNotice?<Text accessibilityRole="alert" style={{fontSize:10,color:"#fff",lineHeight:15}}>{openNotice}</Text>:null}
  </View>
  <View style={{gap:8}}>
   <Text style={{fontSize:14,fontWeight:"900",color:palette.ink}}>Services available</Text>
   <Text style={{fontSize:10,color:palette.muted}}>Live services configured by SKIMA Admin.</Text>
   {catalog.isPending?<StatePanel title="Loading services" description="Checking the active utility catalogue."/>:catalog.error?<StatePanel title="Services unavailable" description="Try again to reload the SKIMA service catalogue." retry={()=>void catalog.refetch()}/>:groups.length?groups.map(([key,name])=><View key={key} style={{minHeight:49,padding:11,borderRadius:14,backgroundColor:palette.surface,borderColor:palette.border,borderWidth:StyleSheet.hairlineWidth,flexDirection:"row",alignItems:"center",gap:9}}><Receipt color={palette.brand} size={16}/><Text style={{flex:1,fontSize:11,fontWeight:"900",color:palette.ink}}>{name}</Text><ArrowRight color={palette.muted} size={15}/></View>):<StatePanel title="No utility services enabled" description="Services will appear once activated in SKIMA Admin."/>}
  </View>
  <Text style={{fontSize:10,color:palette.muted,lineHeight:15}}>Your customer sign-in and SKIMA Wallet remain shared. Opening Bills does not change your Logistics workspace or active bookings.</Text>
 </Screen>;
}
