import { router } from "expo-router";
import { ArrowLeft, WalletCards } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLogisticsQuery, asNumber, asString } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, typography } from "../theme/tokens";
import { Screen } from "../ui/Screen";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { StatePanel } from "../ui/StatePanel";

const money=(amount:number,code:string)=>new Intl.NumberFormat("en-NG",{style:"currency",currency:code,maximumFractionDigits:2}).format(amount);
export function CustomerWalletScreen(){
 const {palette}=useAppTheme();const {session}=useSession();
 const wallets=useLogisticsQuery(["customer-wallets"],"/runtime/wallets",true,30000);
 const balances=useLogisticsQuery(["customer-wallet-balances"],"/runtime/wallet-balances",true,30000);
 const mine=(wallets.data??[]).filter(w=>asString(w,"wallet_type")==="customer"&&asString(w,"owner_entity_type")==="user"&&asString(w,"owner_entity_id")===session?.user.id&&asString(w,"status")==="active");
 return <Screen title="SKIMA Wallet" denseHeader><Pressable onPress={()=>router.back()} style={styles.back}><ArrowLeft color={palette.ink} size={17}/><Text style={{color:palette.ink,fontSize:11,fontWeight:"800"}}>Back</Text></Pressable>
 {wallets.isPending||balances.isPending?<ScreenSkeleton cards={2}/>:wallets.error||balances.error?<StatePanel title="Wallet unavailable" description="Refresh your SKIMA wallet balance." retry={()=>void Promise.all([wallets.refetch(),balances.refetch()])}/>:mine.length?mine.map(w=>{const id=asString(w,"id")??"";const code=asString(w,"currency_code")??"NGN";const balance=asNumber((balances.data??[]).find(b=>asString(b,"wallet_id")===id),"balance")??0;return <View key={id} style={[styles.card,{backgroundColor:palette.surface,borderColor:palette.border}]}><View style={styles.head}><View style={[styles.icon,{backgroundColor:palette.brandSoft}]}><WalletCards color={palette.brand} size={21}/></View><Text style={[styles.currency,{color:palette.ink}]}>{code} Wallet</Text></View><Text style={[styles.amount,{color:palette.ink}]}>{money(balance,code)}</Text><Text style={[styles.hint,{color:palette.muted}]}>Shared SKIMA customer wallet. The same wallet can fund eligible SKIMA services and Store purchases.</Text></View>}) : <StatePanel title="No customer wallet found" description="Create or fund a SKIMA customer wallet to use services that accept wallet payments."/>}
 </Screen>;
}
const styles=StyleSheet.create({back:{flexDirection:"row",alignItems:"center",gap:7},card:{borderWidth:StyleSheet.hairlineWidth,borderRadius:radii.lg,padding:15,gap:10},head:{flexDirection:"row",alignItems:"center",gap:9},icon:{width:42,height:42,borderRadius:14,alignItems:"center",justifyContent:"center"},currency:{fontSize:13,fontWeight:"900"},amount:{fontSize:25,fontWeight:"900"},hint:{...typography.caption,fontSize:10,lineHeight:15}});
