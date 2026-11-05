import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { Bell, ChevronRight, LockKeyhole, LogOut, Moon, ShieldCheck, UserRound, WalletCards } from "lucide-react-native";
import * as Linking from "expo-linking";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { Page, Card, SectionTitle, ActionButton, Field, Notice } from "./BillsUI";

export function BillsAccountScreen({onOpenPage}:{onOpenPage:(page:any)=>void}){
 const session=useSession();const {palette,scheme,toggle}=useAppTheme();
 const currentName=session.context?.profile?.display_name??(typeof session.session?.user.user_metadata?.display_name==="string"?session.session.user.user_metadata.display_name:"");
 const email=session.context?.user.email??session.session?.user.email??"";
 const [name,setName]=useState(currentName);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState("");
 const save=async()=>{
  if(!name.trim()||busy)return;setBusy(true);setNotice("");
  try{const {error}=await session.supabase.auth.updateUser({data:{display_name:name.trim()}});if(error)throw error;await session.refresh();setNotice("Your profile details have been updated.");}
  catch(error){setNotice(error instanceof Error?error.message:"Your profile could not be updated.");}
  finally{setBusy(false);}
 };
 const changePassword=async()=>{
  if(!email){setNotice("An email address is required for password recovery.");return;}
  try{await session.requestPasswordReset(email,Linking.createURL("reset-password"));setNotice("A secure password reset link has been sent when the account email is eligible.");}
  catch(error){setNotice(error instanceof Error?error.message:"Password reset could not be requested.");}
 };
 const signOut=()=>Alert.alert("Sign out of SKIMA Bills?","Your shared SKIMA account and wallet will remain unchanged.",[{text:"Cancel",style:"cancel"},{text:"Sign out",style:"destructive",onPress:()=>void session.signOut()}]);
 return <Page>
  <SectionTitle title="Your account" caption="One SKIMA identity across Refill, Logistics and Bills."/>
  <Card style={{alignItems:"center",paddingVertical:20}}>
   <View style={{width:62,height:62,borderRadius:22,alignItems:"center",justifyContent:"center",backgroundColor:palette.brandSoft}}><UserRound color={palette.brand} size={28}/></View>
   <Text style={{fontSize:16,fontWeight:"900",color:palette.ink}}>{currentName||"SKIMA customer"}</Text>
   <Text style={{fontSize:11,color:palette.muted}}>{email}</Text>
   <View style={{flexDirection:"row",alignItems:"center",gap:5}}><ShieldCheck color={palette.success} size={13}/><Text style={{fontSize:9,color:palette.success,fontWeight:"900"}}>Authenticated SKIMA account</Text></View>
  </Card>
  <Card>
   <SectionTitle title="Profile details"/>
   <Field label="Display name" value={name} onChangeText={setName} placeholder="Your name"/>
   <ActionButton label="Save profile" onPress={()=>void save()} loading={busy} disabled={!name.trim()||name.trim()===currentName}/>
  </Card>
  <View style={{gap:8}}>
   <SectionTitle title="Manage your account"/>
   <AccountLink icon={<WalletCards color={palette.brand} size={18}/>} title="Shared wallet" subtitle="Funding, balances and withdrawals" onPress={()=>onOpenPage("wallet")}/>
   <AccountLink icon={<Bell color={palette.brand} size={18}/>} title="Notifications" subtitle="Bill payment and account updates" onPress={()=>onOpenPage("notifications")}/>
   <AccountLink icon={<ReceiptIcon/>} title="Saved billers" subtitle="Store frequent account details securely" onPress={()=>onOpenPage("saved")}/>
   <AccountLink icon={<LockKeyhole color={palette.brand} size={18}/>} title="Password and security" subtitle="Request a secure password reset" onPress={()=>void changePassword()}/>
   <Pressable onPress={()=>void toggle()} style={{minHeight:57,flexDirection:"row",alignItems:"center",gap:10,padding:11,borderRadius:15,backgroundColor:palette.surface,borderWidth:0.5,borderColor:palette.border}}><Moon color={palette.brand} size={18}/><View style={{flex:1,gap:2}}><Text style={{fontSize:11,fontWeight:"900",color:palette.ink}}>Appearance</Text><Text style={{fontSize:10,color:palette.muted}}>Switch to {scheme==="dark"?"light":"dark"} mode</Text></View><ChevronRight size={16} color={palette.muted}/></Pressable>
  </View>
  {notice?<Notice text={notice} tone={notice.includes("could not")?"error":"success"}/>:null}
  <ActionButton label="Sign out" variant="danger" onPress={signOut}/>
 </Page>;
}
function ReceiptIcon(){return <ShieldCheck color="#E21D2F" size={18}/>;}
function AccountLink({icon,title,subtitle,onPress}:{icon:React.ReactNode;title:string;subtitle:string;onPress:()=>void}){const {palette}=useAppTheme();return <Pressable onPress={onPress} style={{minHeight:58,flexDirection:"row",alignItems:"center",gap:10,padding:11,borderRadius:15,backgroundColor:palette.surface,borderWidth:0.5,borderColor:palette.border}}>{icon}<View style={{flex:1,gap:2}}><Text style={{fontSize:11,fontWeight:"900",color:palette.ink}}>{title}</Text><Text style={{fontSize:10,color:palette.muted}}>{subtitle}</Text></View><ChevronRight color={palette.muted} size={16}/></Pressable>;}
