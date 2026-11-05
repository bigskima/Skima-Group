import { useEffect, useState } from "react";
import { subscribeBillsNavigation } from "../navigation/billsNavigation";
import { Bell, BookOpen, History, ShoppingBag, UserRound, WalletCards, ArrowLeft } from "lucide-react-native";
import { Pressable, SafeAreaView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { BillsHomeScreen } from "./BillsHomeScreen";
import { BillsActivityScreen } from "./BillsActivityScreen";
import { BillsWalletScreen, BillsTopUpScreen, BillsWithdrawScreen } from "./BillsWalletScreens";
import { BillsStoreScreen } from "./BillsStoreScreen";
import { BillsAccountScreen } from "./BillsAccountScreen";
import { BillsNotificationsScreen } from "./BillsNotificationsScreen";
import { BillsBeneficiariesScreen } from "./BillsBeneficiariesScreen";
import { BillsReceiptScreen } from "./BillsReceiptScreen";

type Page = "bills"|"activity"|"wallet"|"store"|"account"|"top-up"|"withdraw"|"notifications"|"saved"|"receipt";
const tabs:{key:Page;label:string;icon:any}[]=[
 {key:"bills",label:"Bills",icon:BookOpen},{key:"activity",label:"Activity",icon:History},
 {key:"wallet",label:"Wallet",icon:WalletCards},{key:"store",label:"Store",icon:ShoppingBag},
 {key:"account",label:"Account",icon:UserRound}
];
export function BillsApp(){
 const {palette}=useAppTheme();const {width}=useWindowDimensions();
 const [page,setPage]=useState<Page>("bills");const [receiptId,setReceiptId]=useState<string|null>(null);
 useEffect(()=>subscribeBillsNavigation(event=>{setPage(event.page);setReceiptId(event.receiptId??null);}),[]);
 const onReceipt=(id:string)=>{setReceiptId(id);setPage("receipt");};
 const isTab=tabs.some(t=>t.key===page);
 const title=page==="bills"?"Pay bills":page==="activity"?"Bill activity":page==="wallet"?"SKIMA Wallet":page==="store"?"SKIMA Store":page==="account"?"Account":page==="top-up"?"Add funds":page==="withdraw"?"Withdraw funds":page==="notifications"?"Notifications":page==="saved"?"Saved billers":"Receipt";
 const open=(next:Page)=>setPage(next);
 return <SafeAreaView style={[styles.safe,{backgroundColor:palette.canvas}]}>
   <View style={[styles.header,{borderBottomColor:palette.border,backgroundColor:palette.surface}]}>
     <View style={styles.identity}>
       {!isTab?<Pressable onPress={()=>setPage("bills")} style={[styles.back,{backgroundColor:palette.brandSoft}]}><ArrowLeft color={palette.brand} size={18}/></Pressable>:<View style={[styles.mark,{backgroundColor:palette.brand}]}><Text style={styles.markLetter}>S</Text></View>}
       <View style={{flex:1,minWidth:0}}><Text style={[styles.brand,{color:palette.ink}]}>SKIMA <Text style={{color:palette.brand}}>BILLS</Text></Text><Text style={[styles.pageTitle,{color:palette.muted}]}>{title}</Text></View>
     </View>
     <Pressable accessibilityRole="button" accessibilityLabel="Notifications" onPress={()=>open("notifications")} style={[styles.bell,{backgroundColor:palette.surfaceSubtle,borderColor:palette.border}]}><Bell color={palette.ink} size={19}/></Pressable>
   </View>
   <View style={styles.content}>
     {page==="bills"?<BillsHomeScreen onOpenPage={open} onReceipt={onReceipt}/>:null}
     {page==="activity"?<BillsActivityScreen onReceipt={onReceipt}/>:null}
     {page==="wallet"?<BillsWalletScreen onOpenPage={open}/>:null}
     {page==="top-up"?<BillsTopUpScreen onBack={()=>open("wallet")}/>:null}
     {page==="withdraw"?<BillsWithdrawScreen onBack={()=>open("wallet")}/>:null}
     {page==="store"?<BillsStoreScreen/>:null}
     {page==="account"?<BillsAccountScreen onOpenPage={open}/>:null}
     {page==="notifications"?<BillsNotificationsScreen/>:null}
     {page==="saved"?<BillsBeneficiariesScreen onOpenPage={open}/>:null}
     {page==="receipt"&&receiptId?<BillsReceiptScreen id={receiptId}/>:null}
   </View>
   {isTab?<View style={[styles.tabs,{backgroundColor:palette.surface,borderTopColor:palette.border}]}>
     {tabs.map(tab=>{const Icon=tab.icon;const selected=tab.key===page;return <Pressable key={tab.key} onPress={()=>open(tab.key)} style={styles.tab} accessibilityRole="button" accessibilityState={{selected}}>
       <Icon color={selected?palette.brand:palette.muted} size={19}/><Text style={{fontSize:10,fontWeight:selected?"900":"700",color:selected?palette.brand:palette.muted}}>{tab.label}</Text>
     </Pressable>;})}
   </View>:null}
 </SafeAreaView>;
}
const styles=StyleSheet.create({
 safe:{flex:1},header:{minHeight:66,paddingHorizontal:18,paddingVertical:10,borderBottomWidth:StyleSheet.hairlineWidth,flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:14},
 identity:{flex:1,minWidth:0,flexDirection:"row",alignItems:"center",gap:11},mark:{width:36,height:36,borderRadius:12,alignItems:"center",justifyContent:"center"},markLetter:{fontSize:20,fontWeight:"900",color:"#fff"},
 brand:{fontSize:12,fontWeight:"900",letterSpacing:.8},pageTitle:{fontSize:10,fontWeight:"700",marginTop:2},back:{width:36,height:36,borderRadius:12,alignItems:"center",justifyContent:"center"},
 bell:{width:38,height:38,borderRadius:13,borderWidth:StyleSheet.hairlineWidth,alignItems:"center",justifyContent:"center"},content:{flex:1},tabs:{minHeight:68,borderTopWidth:StyleSheet.hairlineWidth,flexDirection:"row",alignItems:"center",justifyContent:"space-around",paddingHorizontal:8,paddingBottom:5},
 tab:{flex:1,minHeight:58,alignItems:"center",justifyContent:"center",gap:4}
});
