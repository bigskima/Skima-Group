import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { Bookmark, ChevronRight, Plus, Trash2 } from "lucide-react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BillArraySchema, asString, useBillsQuery, type BillRecord } from "../api/bills";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { Page, Card, SectionTitle, ActionButton, Field, State, Notice } from "./BillsUI";

export function BillsBeneficiariesScreen({onOpenPage}:{onOpenPage:(page:any)=>void}){
 const {session,supabase}=useSession();const {palette}=useAppTheme();const client=useQueryClient();
 const catalog=useBillsQuery(["utility","catalog"],"/runtime/utility-billing/catalog",BillArraySchema,true,60000);
 const userId=session?.user.id??"";
 const [name,setName]=useState("");const [productId,setProductId]=useState("");const [identifier,setIdentifier]=useState("");const [phone,setPhone]=useState("");const [notice,setNotice]=useState("");
 const query=useQuery({queryKey:["skima-bills","saved-beneficiaries",userId],enabled:Boolean(userId),queryFn:async()=>{
  const result=await supabase.from("utility_saved_beneficiaries").select("id,product_id,display_name,customer_identifier,recipient_phone,created_at,updated_at").order("updated_at",{ascending:false});
  if(result.error)throw result.error;return result.data as BillRecord[];
 }});
 const products=catalog.data??[];
 const grouped=useMemo(()=>{const seen=new Set<string>();return products.filter(row=>{const id=asString(row,"product_id");if(!id||seen.has(id))return false;seen.add(id);return true;});},[products]);
 const selected=grouped.find(row=>asString(row,"product_id")===productId);
 const add=useMutation({mutationFn:async()=>{
  if(!userId||!productId||!name.trim()||!identifier.trim())throw new Error("Choose a service and complete the required details.");
  const result=await supabase.from("utility_saved_beneficiaries").insert({customer_user_id:userId,product_id:productId,display_name:name.trim(),customer_identifier:identifier.trim(),recipient_phone:phone.trim()||null}).select("id").single();
  if(result.error)throw result.error;return result.data;
 },onSuccess:async()=>{setName("");setProductId("");setIdentifier("");setPhone("");setNotice("Biller saved to your SKIMA account.");await client.invalidateQueries({queryKey:["skima-bills","saved-beneficiaries",userId]});}});
 const remove=useMutation({mutationFn:async(id:string)=>{const result=await supabase.from("utility_saved_beneficiaries").delete().eq("id",id);if(result.error)throw result.error;},onSuccess:()=>client.invalidateQueries({queryKey:["skima-bills","saved-beneficiaries",userId]})});
 const use=async(row:BillRecord)=>{
  await AsyncStorage.setItem("skima:bills:pending-beneficiary:"+userId,JSON.stringify({productId:asString(row,"product_id"),customerIdentifier:asString(row,"customer_identifier"),recipientPhone:asString(row,"recipient_phone"),displayName:asString(row,"display_name")}));
  onOpenPage("bills");
 };
 const productTitle=(id:string)=>asString(grouped.find(p=>asString(p,"product_id")===id),"product_name")??"Utility service";
 return <Page>
  <SectionTitle title="Saved billers" caption="Keep the account details you pay most often ready for your next bill."/>
  <Card>
   <SectionTitle title="Add a biller" caption="Choose a current service and save its account details."/>
   <View style={{gap:7}}><Text style={{fontSize:11,fontWeight:"900",color:palette.ink}}>Service</Text>
    <View style={{flexDirection:"row",flexWrap:"wrap",gap:6}}>{grouped.slice(0,30).map((row,i)=>{const id=asString(row,"product_id")??"";const active=id===productId;return <Pressable key={id||String(i)} onPress={()=>setProductId(id)} style={{paddingHorizontal:9,paddingVertical:8,borderRadius:11,borderWidth:1,borderColor:active?palette.brand:palette.border,backgroundColor:active?palette.brandSoft:palette.surfaceSubtle}}><Text style={{fontSize:9,fontWeight:"800",color:active?palette.brand:palette.ink}}>{asString(row,"product_name")??"Bill service"}</Text></Pressable>;})}</View>
   </View>
   <Field label="Name for this biller" value={name} onChangeText={setName} placeholder="e.g. Home electricity"/>
   <Field label={asString(selected,"customer_identifier_label")??"Account or phone number"} value={identifier} onChangeText={setIdentifier} placeholder={asString(selected,"customer_identifier_hint")??"Enter customer details"}/>
   <Field label="Recipient phone (optional)" value={phone} onChangeText={setPhone} placeholder="Phone number"/>
   <ActionButton label="Save biller" onPress={()=>add.mutate()} disabled={!productId||!name.trim()||!identifier.trim()} loading={add.isPending}/>
   {add.error?<Notice tone="error" text={add.error.message}/>:null}
   {notice?<Notice tone="success" text={notice}/>:null}
  </Card>
  <View style={{gap:9}}>
   <SectionTitle title="Your saved billers" caption={(query.data?.length??0)+" saved entries"}/>
   {query.isPending?<State title="Loading saved billers" body="Retrieving your private saved service details."/>:query.error?<State title="Saved billers unavailable" body="Check that the Bills saved-biller database update has been applied." retry={()=>void query.refetch()}/>:!query.data?.length?<State title="No saved billers yet" body="Add an electricity, airtime, data or TV account and it will be available here next time."/>:query.data.map(row=>{const id=asString(row,"id")??"";const productId=asString(row,"product_id")??"";return <Card key={id} style={{flexDirection:"row",alignItems:"center",gap:9}}><View style={{width:36,height:36,borderRadius:12,backgroundColor:palette.brandSoft,alignItems:"center",justifyContent:"center"}}><Bookmark color={palette.brand} size={17}/></View><View style={{flex:1,gap:3}}><Text style={{fontSize:11,fontWeight:"900",color:palette.ink}}>{asString(row,"display_name")??"Saved biller"}</Text><Text style={{fontSize:9,color:palette.muted}}>{productTitle(productId)} · {asString(row,"customer_identifier")??""}</Text></View><Pressable onPress={()=>void use(row)}><Text style={{fontSize:10,fontWeight:"900",color:palette.brand}}>Use</Text></Pressable><Pressable onPress={()=>Alert.alert("Remove saved biller?","This only removes the saved details, not your SKIMA account.",[{text:"Cancel",style:"cancel"},{text:"Remove",style:"destructive",onPress:()=>remove.mutate(id)}])}><Trash2 size={16} color={palette.danger}/></Pressable></Card>;})}
  </View>
 </Page>;
}
