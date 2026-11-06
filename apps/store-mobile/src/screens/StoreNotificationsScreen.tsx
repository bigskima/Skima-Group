import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from "react-native";
import { Bell, CheckCheck, ChevronRight } from "lucide-react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { requestStoreNotificationPermission, registerStorePushDevice } from "../notifications/StoreNotificationLifecycle";
import { navigateStoreRoute } from "../navigation/storeNavigation";
import { Page, Card, SectionTitle, ActionButton, State, Notice } from "./StoreUI";

const Center=z.object({items:z.array(z.record(z.string(),z.unknown())),unreadCount:z.number().int().nonnegative(),totalCount:z.number().int().nonnegative(),offset:z.number().int().nonnegative(),limit:z.number().int().positive(),hasMore:z.boolean()});
type Row=Record<string,unknown>;
const str=(r:Row,k:string)=>typeof r[k]==="string"?r[k] as string:null;
function pathOf(message:Row){const p=message.payload&&typeof message.payload==="object"?message.payload as Row:{};const m=message.metadata&&typeof message.metadata==="object"?message.metadata as Row:{};return str(p,"deepLink")??str(p,"deep_link")??str(p,"path")??str(m,"deepLink")??str(m,"path");}
export function StoreNotificationsScreen(){
 const session=useSession();const {palette}=useAppTheme();const client=useQueryClient();
 const query=useQuery({queryKey:["skima-store","inbox",40],enabled:session.status==="authenticated",refetchInterval:30000,queryFn:async()=>{const r=await session.supabase.rpc("read_notification_center",{target_limit:40,target_offset:0,target_include_read:true});if(r.error)throw r.error;return Center.parse(r.data);}});
 const mark=useMutation({mutationFn:async(id:string)=>{const r=await session.supabase.rpc("mark_notification_read",{target_message_id:id,target_read:true});if(r.error)throw r.error;return r.data;},onSuccess:()=>client.invalidateQueries({queryKey:["skima-store","inbox"]})});
 const markAll=useMutation({mutationFn:async()=>{const r=await session.supabase.rpc("mark_all_notifications_read");if(r.error)throw r.error;return r.data;},onSuccess:()=>client.invalidateQueries({queryKey:["skima-store","inbox"]})});
 const [feedback,setFeedback]=useState("");
 const enable=async()=>{try{await requestStoreNotificationPermission();await registerStorePushDevice(session.session,session.supabase);setFeedback("Device permission is enabled and this installation is registered for remote SKIMA store notifications.");}catch(e){setFeedback(e instanceof Error?e.message:"Notification permission was not granted.");}};

 const rows=useMemo(()=>query.data?.items??[],[query.data]);
 return <Page refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={()=>void query.refetch()} tintColor={palette.brand}/>}>
  <SectionTitle title="Notifications" caption="Important updates from your SKIMA Store account." action={query.data?.unreadCount?<ActionButton label="Mark all read" variant="quiet" small onPress={()=>markAll.mutate()}/>:null}/>
  <Card style={{flexDirection:"row",alignItems:"center",gap:9}}><Bell color={palette.brand} size={19}/><View style={{flex:1,gap:2}}><Text style={{fontSize:11,color:palette.ink,fontWeight:"900"}}>Device notifications</Text><Text style={{fontSize:10,color:palette.muted}}>Allow this app to show notifications on your device.</Text></View><ActionButton label="Enable" small variant="secondary" onPress={()=>void enable()}/></Card>
  {feedback?<Notice text={feedback} tone="info"/>:null}
  {query.isPending?<ActivityIndicator color={palette.brand}/>:query.error?<State title="Inbox unavailable" body="Your account and Store orders are unchanged. Refresh to try again." retry={()=>void query.refetch()}/>:!rows.length?<State title="You're all caught up" body="Store order updates and account messages will appear here."/>:<Card>{rows.map((item,index)=>{const id=str(item,"id");const payload=item.payload&&typeof item.payload==="object"?item.payload as Row:{};const title=str(payload,"title")??str(item,"title")??str(item,"purpose")??"SKIMA update";const body=str(payload,"body")??str(payload,"message")??str(item,"message")??"There is a new update in your SKIMA account.";const isRead=item.isRead===true||item.is_read===true;return <Pressable key={id??String(index)} onPress={()=>{if(id&&!isRead)mark.mutate(id);const destination=pathOf(item);if(destination)navigateStoreRoute(destination);}} style={{paddingVertical:12,borderTopWidth:index?0.5:0,borderTopColor:palette.border,flexDirection:"row",alignItems:"flex-start",gap:10}}><View style={{width:36,height:36,borderRadius:12,backgroundColor:palette.brandSoft,alignItems:"center",justifyContent:"center"}}>{isRead?<CheckCheck color={palette.muted} size={16}/>:<Bell color={palette.brand} size={16}/>}</View><View style={{flex:1,gap:4}}><Text style={{fontSize:11,fontWeight:isRead?"700":"900",color:palette.ink}}>{title}</Text><Text style={{fontSize:10,lineHeight:16,color:palette.muted}}>{body}</Text><Text style={{fontSize:9,color:palette.muted}}>{str(item,"created_at")?new Date(str(item,"created_at")!).toLocaleString("en-NG"):""}</Text></View>{!isRead?<View style={{width:7,height:7,borderRadius:5,backgroundColor:palette.brand,marginTop:5}}/>:null}<ChevronRight color={palette.muted} size={14}/></Pressable>;})}</Card>}
  <Text style={{fontSize:9,color:palette.muted,lineHeight:14}}>The in-app inbox remains available independently of device push settings.</Text>
 </Page>;
}
