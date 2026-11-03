import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { ArrowLeft, Bell, CheckCheck, ChevronRight, RefreshCw } from "lucide-react-native";
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, typography } from "../theme/tokens";
import { Screen } from "../ui/Screen";
import { StatePanel } from "../ui/StatePanel";

const MessageSchema=z.record(z.string(),z.unknown());
const CenterSchema=z.object({
 items:z.array(MessageSchema),
 unreadCount:z.number().int().nonnegative(),
 totalCount:z.number().int().nonnegative(),
 offset:z.number().int().nonnegative(),
 limit:z.number().int().positive(),
 hasMore:z.boolean(),
});
const getString=(value:unknown,...keys:string[])=>{
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const row=value as Record<string,unknown>;
 for(const key of keys)if(typeof row[key]==="string"&&(row[key] as string).trim())return row[key] as string;
 return null;
};
const getNested=(value:unknown,key:string)=>{
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const child=(value as Record<string,unknown>)[key];
 return child&&typeof child==="object"&&!Array.isArray(child)?child:null;
};
const dateLabel=(value:string|null)=>{
 if(!value)return "Recent";
 const parsed=new Date(value);return Number.isNaN(parsed.getTime())?"Recent":new Intl.DateTimeFormat("en-NG",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}).format(parsed);
};
export function LogisticsNotificationsScreen(){
 const session=useSession();const {palette}=useAppTheme();const queryClient=useQueryClient();
 const center=useQuery({
  queryKey:["logistics-notifications",session.session?.user.id],
  enabled:session.status==="authenticated",
  refetchInterval:30000,
  queryFn:async()=>{
   const {data,error}=await session.supabase.rpc("read_notification_center",{target_limit:60,target_offset:0,target_include_read:true});
   if(error)throw error;return CenterSchema.parse(data);
  }
 });
 const markRead=useMutation({
  mutationFn:async(messageId:string)=>{
   const {data,error}=await session.supabase.rpc("mark_notification_read",{target_message_id:messageId,target_read:true});
   if(error)throw error;return data;
  },
  onSuccess:async()=>{await queryClient.invalidateQueries({queryKey:["logistics-notifications",session.session?.user.id]});}
 });
 const markAll=useMutation({
  mutationFn:async()=>{
   const {data,error}=await session.supabase.rpc("mark_all_notifications_read");
   if(error)throw error;return data;
  },
  onSuccess:async()=>{await queryClient.invalidateQueries({queryKey:["logistics-notifications",session.session?.user.id]});}
 });
 const messages=center.data?.items??[];
 const open=async(message:Record<string,unknown>)=>{
  const id=getString(message,"id","message_id");
  if(id&&message.isRead!==true)await markRead.mutateAsync(id);
  const target=getString(getNested(message,"payload"),"deepLink","deep_link","path","route","url")??
   getString(getNested(message,"metadata"),"deepLink","deep_link","path","route","url");
  if(target?.startsWith("/"))router.push(target as never);
 };
 return <Screen title="Notifications" denseHeader action={<View style={styles.topActions}><Bell color={palette.brand} size={18}/>{center.data?.unreadCount? <Text style={[styles.unread,{color:palette.brand}]}>{center.data.unreadCount} new</Text>:null}</View>}
  refreshControl={<RefreshControl refreshing={center.isRefetching} onRefresh={()=>void center.refetch()} tintColor={palette.brand}/>}>
  <Pressable onPress={()=>router.back()} style={styles.back}><ArrowLeft color={palette.ink} size={17}/><Text style={{color:palette.ink,fontSize:11,fontWeight:"800"}}>Back</Text></Pressable>
  {center.isPending?<View style={styles.loading}><ActivityIndicator color={palette.brand}/></View>:center.error?<StatePanel title="Notifications unavailable" description="Refresh to reconnect to your notification inbox." retry={()=>void center.refetch()}/>:messages.length?<>
   {center.data?.unreadCount? <Pressable disabled={markAll.isPending} onPress={()=>markAll.mutate()} style={[styles.markAll,{borderColor:palette.border,backgroundColor:palette.surface}]}>{markAll.isPending?<ActivityIndicator color={palette.brand}/>:<CheckCheck color={palette.brand} size={16}/>}<Text style={{color:palette.brand,fontSize:10,fontWeight:"900"}}>Mark all read</Text></Pressable>:null}
   <View style={{gap:8}}>{messages.map((message,index)=>{
    const id=getString(message,"id","message_id")??String(index);
    const payload=getNested(message,"payload");const metadata=getNested(message,"metadata");
    const title=getString(payload,"title","subject")??getString(message,"purpose")?.replace(/[._]/g," ")??"SKIMA update";
    const body=getString(payload,"body","message","text")??"You have a new update from SKIMA.";
    const target=getString(payload,"deepLink","deep_link","path","route","url")??getString(metadata,"deepLink","deep_link","path","route","url");
    const read=message.isRead===true;
    return <Pressable key={id} onPress={()=>void open(message)} style={[styles.message,{backgroundColor:read?palette.surface:palette.brandSofter,borderColor:read?palette.border:palette.brandSoft}]}>
     <View style={[styles.messageIcon,{backgroundColor:palette.brandSoft}]}><Bell color={palette.brand} size={17}/></View>
     <View style={{flex:1,minWidth:0,gap:3}}>
      <View style={styles.messageHead}>{!read?<View style={[styles.dot,{backgroundColor:palette.brand}]}/>:null}<Text numberOfLines={1} style={[styles.messageTitle,{color:palette.ink}]}>{title}</Text><Text style={[styles.time,{color:palette.muted}]}>{dateLabel(getString(message,"created_at","createdAt"))}</Text></View>
      <Text numberOfLines={2} style={[styles.body,{color:palette.muted}]}>{body}</Text>
     </View>
     {target?<ChevronRight color={palette.muted} size={17}/>:null}
    </Pressable>;
   })}</View>
  </>:<StatePanel title="You are all caught up" description="New Logistics updates will appear here." icon={<Bell color={palette.brand} size={22}/>}/>}
  </Screen>;
}
const styles=StyleSheet.create({
 topActions:{flexDirection:"row",alignItems:"center",gap:6},unread:{fontSize:10,fontWeight:"900"},
 back:{flexDirection:"row",alignItems:"center",gap:7},loading:{padding:28,alignItems:"center"},
 markAll:{minHeight:39,borderWidth:StyleSheet.hairlineWidth,borderRadius:radii.md,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:7},
 message:{flexDirection:"row",alignItems:"center",gap:9,borderWidth:StyleSheet.hairlineWidth,borderRadius:radii.lg,padding:11},
 messageIcon:{width:36,height:36,borderRadius:12,alignItems:"center",justifyContent:"center"},
 messageHead:{flexDirection:"row",alignItems:"center",gap:5},dot:{width:6,height:6,borderRadius:3},
 messageTitle:{flex:1,minWidth:0,fontSize:11,fontWeight:"900"},time:{fontSize:8,fontWeight:"700"},
 body:{...typography.caption,fontSize:10,lineHeight:14},
});
