import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Megaphone } from "lucide-react-native";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { navigateStoreRoute } from "../navigation/storeNavigation";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";

type Promotion={title:string|null;body:string|null;mediaUrl:string|null;accessibilityLabel:string|null;ctaLabel:string|null;ctaAction:Record<string,unknown>};
export function StorePromotionBanner(){
 const {supabase}=useSession();const {palette}=useAppTheme();
 const query=useQuery<Promotion|null>({queryKey:["store-home-promotion"],staleTime:120_000,queryFn:async()=>{
  const {data,error}=await supabase.rpc("read_published_product_content",{target_placement_keys:["mobile.home.promotion"],target_module_key:"store",target_audience_key:"customer",target_country_code:null,target_region:null,target_city:null});
  if(error)throw error;const row=Array.isArray(data)?data[0] as Record<string,unknown>|undefined:undefined;if(!row)return null;
  const metadata=isRecord(row.metadata)?row.metadata:{};const bucket=readString(row.media_storage_bucket);const path=readString(row.media_storage_path);
  const mediaUrl=readString(metadata.media_public_url)??readString(metadata.mediaPublicUrl)??(bucket&&path?supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl:null);
  return {title:readString(row.title),body:readString(row.body),mediaUrl,accessibilityLabel:readString(row.accessibility_label),ctaLabel:readString(row.cta_label),ctaAction:isRecord(row.cta_action)?row.cta_action:{}};
 }});
 const item=query.data;if(!item||query.isError)return null;
 const type=readString(item.ctaAction.type);const target=readString(item.ctaAction.value)??readString(item.ctaAction.target);
 const clickable=Boolean(target&&(type==="route"||type==="url"));
 const open=()=>{if(!target)return;if(type==="route")navigateStoreRoute(target);else if(type==="url"&&/^https:\/\//i.test(target))void Linking.openURL(target).catch(()=>undefined);};
 return <View style={styles.wrap}><Pressable disabled={!clickable} onPress={open} accessibilityRole={clickable?"button":undefined} accessibilityLabel={item.accessibilityLabel??item.title??"SKIMA Store promotion"} style={[styles.banner,{backgroundColor:palette.brand}]}>
  <LinearGradient colors={["#E21D2F","#94121F"]} style={StyleSheet.absoluteFill}/>
  {item.mediaUrl?<Image source={{uri:item.mediaUrl}} resizeMode="cover" style={StyleSheet.absoluteFill}/>:null}
  {item.mediaUrl?<LinearGradient colors={["rgba(0,0,0,.06)","rgba(0,0,0,.7)"]} style={StyleSheet.absoluteFill}/>:null}
  <View style={styles.copy}><View style={styles.eyebrow}><Megaphone color="#fff" size={13}/><Text style={styles.eyebrowText}>SKIMA FOR YOU</Text></View>
   <Text numberOfLines={2} style={styles.title}>{item.title??"Find more of what you need"}</Text>
   {item.body?<Text numberOfLines={2} style={styles.body}>{item.body}</Text>:null}
   {clickable?<View style={styles.cta}><Text style={styles.ctaText}>{item.ctaLabel??"Explore"}</Text><ArrowUpRight color="#A31222" size={15}/></View>:null}
  </View>
 </Pressable></View>;
}
function isRecord(value:unknown):value is Record<string,unknown>{return typeof value==="object"&&value!==null&&!Array.isArray(value)}
function readString(value:unknown):string|null{return typeof value==="string"&&value.trim()?value.trim():null}
const styles=StyleSheet.create({wrap:{width:"100%"},banner:{width:"100%",aspectRatio:16/7,minHeight:172,maxHeight:230,overflow:"hidden",borderRadius:19,padding:16,justifyContent:"center"},copy:{alignItems:"flex-start",maxWidth:540,gap:7},eyebrow:{flexDirection:"row",alignItems:"center",gap:6},eyebrowText:{color:"rgba(255,255,255,.82)",fontSize:8,fontWeight:"900",letterSpacing:1.2},title:{color:"#fff",fontSize:19,lineHeight:23,fontWeight:"900",maxWidth:400},body:{color:"rgba(255,255,255,.82)",fontSize:10,lineHeight:15,maxWidth:450},cta:{minHeight:32,backgroundColor:"#fff",borderRadius:30,paddingHorizontal:12,flexDirection:"row",alignItems:"center",gap:6,marginTop:2},ctaText:{color:"#A31222",fontSize:10,fontWeight:"900"}});
