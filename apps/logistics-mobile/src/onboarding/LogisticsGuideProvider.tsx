import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useSegments } from "expo-router";
import { ArrowLeft, Clock3, HelpCircle, X } from "lucide-react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";

type Workspace = "customer" | "company";
type Step = { route: string; targetKey: string; title: string; body: string };
type Rect = { x:number;y:number;width:number;height:number };
type GuideContextValue = { active:boolean; startNow:(workspace:Workspace)=>void; register:(key:string,node:View|null,route:string)=>void };
const GuideContext=createContext<GuideContextValue|null>(null);

const STEPS:Record<Workspace,Step[]>={
 customer:[
  {route:"(customer)/index",targetKey:"customer-home-request",title:"Create a delivery request",body:"Start a move or delivery request. Your route, cargo and timing help SKIMA match qualified providers."},
  {route:"(customer)/index",targetKey:"customer-home-services",title:"Choose a service",body:"Browse only the services enabled for your area. You can compare provider offers after publishing a request."},
  {route:"(customer)/index",targetKey:"customer-home-wallet",title:"Your shared SKIMA wallet",body:"Your customer wallet is shared across eligible SKIMA services. It is separate from logistics company wallets."},
  {route:"(customer)/index",targetKey:"customer-home-store",title:"SKIMA Store",body:"The Store is an additional product area for catalogued goods. It does not replace Logistics."},
 ],
 company:[
  {route:"(provider)/index",targetKey:"company-home-overview",title:"Company operations",body:"Your company overview shows matched opportunities and active jobs. Open an opportunity to review and respond."},
  {route:"(provider)/workspace",targetKey:"company-workspace-finance",title:"Company wallet and payouts",body:"Only authorized company owners can manage earnings and payment settings. Operating-fee funds remain separate from withdrawable Logistics earnings."},
  {route:"(provider)/workspace",targetKey:"company-workspace-services",title:"Services and team",body:"Configure what the company can fulfil and grant staff only the workspace access they need."},
 ],
};

export function LogisticsGuideProvider({children}:PropsWithChildren){
 const {status,session}=useSession();
 const segments=useSegments();
 const route=segments.join("/");
 const {palette}=useAppTheme();
 const {width,height}=useWindowDimensions();
 const [workspace,setWorkspace]=useState<Workspace|null>(null);
 const [active,setActive]=useState(false);
 const [stepIndex,setStepIndex]=useState(0);
 const [rect,setRect]=useState<Rect|null>(null);
 const [remind,setRemind]=useState(false);
 const targets=useRef(new Map<string,View>());
 const steps=workspace?STEPS[workspace]:[];
 const step=steps[stepIndex]??null;

 const register=useCallback((key:string,node:View|null,targetRoute:string)=>{
  const mapKey=`${targetRoute}::${key}`;
  if(node)targets.current.set(mapKey,node);else targets.current.delete(mapKey);
 },[]);

 const finish=useCallback(async()=>{
  if(workspace&&session?.user.id)await AsyncStorage.setItem(`skima:logistics:guide:${session.user.id}:${workspace}:completed`,"1");
  setActive(false);setRemind(false);setRect(null);
 },[session?.user.id,workspace]);

 const startNow=useCallback((nextWorkspace:Workspace)=>{
  setWorkspace(nextWorkspace);setStepIndex(0);setRect(null);setRemind(false);setActive(true);
  const first=STEPS[nextWorkspace][0];
  if(first && route!==first.route)router.navigate((nextWorkspace==="customer"?"/(customer)":"locations") as never);
 },[route]);

 useEffect(()=>{
  if(status!=="authenticated"||!session?.user.id||!route.endsWith("/index"))return;
  const nextWorkspace:Workspace=route.startsWith("(customer)")?"customer":route.startsWith("(provider)")?"company":null as never;
  if(!nextWorkspace)return;
  let cancelled=false;
  void (async()=>{
   const completed=await AsyncStorage.getItem(`skima:logistics:guide:${session.user.id}:${nextWorkspace}:completed`);
   const snooze=Number(await AsyncStorage.getItem(`skima:logistics:guide:${session.user.id}:${nextWorkspace}:remind`)??"0");
   if(!cancelled&&!completed&&(!snooze||snooze<=Date.now())){
    setWorkspace(nextWorkspace);setStepIndex(0);setActive(true);
   }
  })();
  return()=>{cancelled=true;};
 },[route,session?.user.id,status]);

 useEffect(()=>{
  if(!active||!step)return;
  if(route!==step.route){
   if(step.route==="(customer)/index")router.navigate("/(customer)" as never);
   else if(step.route==="(provider)/index")router.navigate("/(provider)" as never);
   else if(step.route==="(provider)/workspace")router.navigate("/(provider)/workspace" as never);
   return;
  }
  let cancelled=false;let attempt=0;let timer:ReturnType<typeof setTimeout>|null=null;
  const measure=()=>{
   timer=setTimeout(()=>{
    if(cancelled)return;
    const target=targets.current.get(`${step.route}::${step.targetKey}`);
    if(!target){
     if(attempt++<16)measure();else setRect(null);
     return;
    }
    target.measureInWindow((x,y,w,h)=>{
     if(cancelled)return;
     if(w>0&&h>0){setRect({x:Math.max(0,x),y:Math.max(0,y),width:Math.min(w,width),height:Math.min(h,height)});}
     else if(attempt++<16)measure();
    });
   },attempt===0?100:130);
  };
  measure();
  return()=>{cancelled=true;if(timer)clearTimeout(timer);};
 },[active,step,route,width,height]);

 const next=()=>{
  if(stepIndex>=steps.length-1){void finish();return;}
  const nextIndex=stepIndex+1;setStepIndex(nextIndex);
  const nextStep=steps[nextIndex];
  if(nextStep&&nextStep.route!==route){
   if(nextStep.route==="(provider)/workspace")router.navigate("/(provider)/workspace" as never);
   else if(nextStep.route==="(provider)/index")router.navigate("/(provider)" as never);
   else router.navigate("/(customer)" as never);
  }
 };
 const snooze=async()=>{
  if(workspace&&session?.user.id)await AsyncStorage.setItem(`skima:logistics:guide:${session.user.id}:${workspace}:remind`,String(Date.now()+7*24*60*60*1000));
  setActive(false);setRemind(false);setRect(null);
 };

 return <GuideContext.Provider value={{active,startNow,register}}>
  {children}
  <Modal visible={active&&Boolean(step)} transparent animationType="fade" statusBarTranslucent onRequestClose={()=>setRemind(true)}>
   <View style={styles.overlay}>
    {rect?<View pointerEvents="none" style={[styles.spotlight,{left:Math.max(8,rect.x-5),top:Math.max(8,rect.y-5),width:Math.min(width-16,rect.width+10),height:Math.min(height-16,rect.height+10),borderColor:palette.brand}]}/>:null}
    <View style={[styles.tooltip,{backgroundColor:palette.surface,borderColor:palette.border,top:rect&&rect.y>height*0.58?Math.max(56,rect.y-210):Math.min(height-230,rect?rect.y+rect.height+18:height*0.36)}]}>
     <View style={styles.tooltipTop}><Text style={[styles.progress,{color:palette.brand}]}>STEP {stepIndex+1} OF {steps.length}</Text><Pressable onPress={()=>setRemind(true)}><X color={palette.muted} size={18}/></Pressable></View>
     <Text style={[styles.title,{color:palette.ink}]}>{step?.title}</Text>
     <Text style={[styles.body,{color:palette.muted}]}>{step?.body}</Text>
     <View style={styles.actions}>
      <Pressable onPress={()=>setRemind(true)} style={[styles.secondary,{borderColor:palette.border}]}><Clock3 color={palette.muted} size={14}/><Text style={{color:palette.muted,fontSize:10,fontWeight:"800"}}>Remind me later</Text></Pressable>
      <Pressable onPress={next} style={[styles.primary,{backgroundColor:palette.brand}]}><Text style={styles.primaryText}>{stepIndex===steps.length-1?"Finish":"Next"}</Text></Pressable>
     </View>
    </View>
   </View>
  </Modal>
  <Modal visible={remind} transparent animationType="fade" onRequestClose={()=>setRemind(false)}>
   <View style={styles.promptBackdrop}><View style={[styles.prompt,{backgroundColor:palette.surface,borderColor:palette.border}]}>
    <Text style={[styles.title,{color:palette.ink}]}>Pause this tour?</Text>
    <Text style={[styles.body,{color:palette.muted}]}>We can remind you in 7 days, or you can skip the rest of this guide.</Text>
    <Pressable onPress={()=>void snooze()} style={[styles.primary,{backgroundColor:palette.brand}]}><Text style={styles.primaryText}>Remind me in 7 days</Text></Pressable>
    <Pressable onPress={()=>void finish()} style={[styles.secondary,{borderColor:palette.border}]}><Text style={{color:palette.muted,fontSize:11,fontWeight:"800"}}>Skip this tour</Text></Pressable>
    <Pressable onPress={()=>setRemind(false)}><Text style={{color:palette.brand,fontSize:10,fontWeight:"800",textAlign:"center"}}>Continue tour</Text></Pressable>
   </View></View>
  </Modal>
 </GuideContext.Provider>;
}

export function useLogisticsGuide(){const value=useContext(GuideContext);if(!value)throw new Error("useLogisticsGuide must be used inside LogisticsGuideProvider");return value;}

export function GuideTarget({targetKey,style,children}:{targetKey:string;style?:StyleProp<ViewStyle>;children:ReactNode}){
 const guide=useLogisticsGuide();const segments=useSegments();const route=segments.join("/");
 const attach=(node:View|null)=>guide.register(targetKey,node,route);
 return <View ref={attach} collapsable={false} style={style}>{children}</View>;
}

export function GuideLaunchLink({workspace}:{workspace:Workspace}){
 const guide=useLogisticsGuide();const {palette}=useAppTheme();
 return <Pressable onPress={()=>guide.startNow(workspace)} style={styles.launch}><HelpCircle color={palette.brand} size={15}/><Text style={{color:palette.brand,fontSize:10,fontWeight:"900"}}>Take a quick tour</Text></Pressable>;
}

const styles=StyleSheet.create({
 overlay:{flex:1,backgroundColor:"rgba(8,8,10,.62)"},
 spotlight:{position:"absolute",borderWidth:2,borderRadius:16,backgroundColor:"transparent",shadowColor:"#000",shadowOpacity:.4,shadowRadius:12,elevation:8},
 tooltip:{position:"absolute",left:16,right:16,borderWidth:1,borderRadius:radii.lg,padding:15,gap:9,elevation:12},
 tooltipTop:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},progress:{...typography.eyebrow,fontSize:8},
 title:{fontSize:17,fontWeight:"900",lineHeight:22},body:{fontSize:11,lineHeight:17},
 actions:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:8,marginTop:2},
 secondary:{minHeight:38,paddingHorizontal:10,borderWidth:1,borderRadius:radii.md,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:6},
 primary:{minHeight:40,paddingHorizontal:16,borderRadius:radii.md,alignItems:"center",justifyContent:"center"},primaryText:{fontSize:11,fontWeight:"900",color:"#fff"},
 promptBackdrop:{flex:1,justifyContent:"center",alignItems:"center",backgroundColor:"rgba(8,8,10,.62)",padding:20},
 prompt:{width:"100%",maxWidth:360,borderWidth:1,borderRadius:radii.xl,padding:17,gap:11},
 launch:{flexDirection:"row",alignItems:"center",gap:6,paddingVertical:7,paddingHorizontal:10},
});
