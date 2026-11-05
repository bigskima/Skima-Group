import type { ReactElement, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { findNodeHandle, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type RefreshControlProps } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import type { BillsPage } from "../navigation/billsNavigation";
import { useOptionalBillsGuide } from "../onboarding/BillsGuideProvider";

export function Page({children,refreshControl,guidePage}:{children:ReactNode;refreshControl?:ReactElement<RefreshControlProps>;guidePage?:BillsPage}){
 const {width}=useWindowDimensions();
 const guide=useOptionalBillsGuide();
 const scrollRef=useRef<ScrollView|null>(null);
 useEffect(()=>{
  if(!guidePage||!guide)return;
  return guide.registerScroller(guidePage,(target)=>{
   const scrollHandle=findNodeHandle(scrollRef.current);
   if(scrollHandle===null)return;
   target.measureLayout(scrollHandle,(_x,y)=>scrollRef.current?.scrollTo({y:Math.max(0,y-56),animated:true}),()=>undefined);
  });
 },[guidePage,guide?.registerScroller]);
 return <ScrollView ref={scrollRef} refreshControl={refreshControl} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:width<600?16:24,paddingBottom:30,alignItems:"center"}}>
  <View style={{width:"100%",maxWidth:width>=1100?1120:840,gap:15}}>{children}</View>
 </ScrollView>;
}
export function Card({children,style}:{children:ReactNode;style?:any}){
 const {palette}=useAppTheme();return <View style={[styles.card,{backgroundColor:palette.surface,borderColor:palette.border},style]}>{children}</View>;
}
export function SectionTitle({title,caption,action}:{title:string;caption?:string;action?:ReactNode}){
 const {palette}=useAppTheme();return <View style={styles.sectionHead}><View style={{flex:1,gap:2}}><Text style={{fontSize:15,fontWeight:"900",color:palette.ink}}>{title}</Text>{caption?<Text style={{fontSize:11,color:palette.muted,lineHeight:16}}>{caption}</Text>:null}</View>{action}</View>;
}
export function ActionButton({label,onPress,variant="primary",disabled=false,loading=false,small=false}:{label:string;onPress:()=>void;variant?:"primary"|"secondary"|"quiet"|"danger";disabled?:boolean;loading?:boolean;small?:boolean}){
 const {palette}=useAppTheme();const bg=variant==="primary"?palette.brand:variant==="danger"?palette.danger:variant==="secondary"?palette.surfaceSubtle:"transparent";
 const color=variant==="primary"||variant==="danger"?"#fff":variant==="quiet"?palette.brand:palette.ink;
 return <Text accessibilityRole="button" accessibilityState={{disabled:disabled||loading}} onPress={!disabled&&!loading?onPress:undefined} style={{overflow:"hidden",textAlign:"center",textAlignVertical:"center",paddingHorizontal:small?12:16,paddingVertical:small?9:13,minHeight:small?34:45,borderRadius:14,backgroundColor:bg,color,fontSize:small?11:12,fontWeight:"900",borderWidth:variant==="quiet"?0:StyleSheet.hairlineWidth,borderColor:palette.border,opacity:disabled||loading?0.45:1}}>{loading?"Please wait…":label}</Text>;
}
export function Field({label,value,onChangeText,placeholder,keyboardType="default",secureTextEntry=false,hint}:{label:string;value:string;onChangeText:(value:string)=>void;placeholder?:string;keyboardType?:"default"|"numeric"|"decimal-pad"|"email-address"|"phone-pad";secureTextEntry?:boolean;hint?:string}){
 const {palette}=useAppTheme();const [focused,setFocused]=useState(false);
 return <View style={{gap:6}}>
  <Text style={{fontSize:11,fontWeight:"900",color:palette.mutedStrong}}>{label}</Text>
  <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={palette.muted} keyboardType={keyboardType} secureTextEntry={secureTextEntry} onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)} autoCapitalize="none" style={{minHeight:50,borderRadius:14,borderWidth:1,borderColor:focused?palette.brand:palette.border,backgroundColor:palette.input,paddingHorizontal:13,color:palette.ink,fontSize:13}}/>
  {hint?<Text style={{fontSize:10,color:palette.muted}}>{hint}</Text>:null}
 </View>;
}
export function Notice({text,tone="info"}:{text:string;tone?:"info"|"success"|"error"|"warning"}){
 const {palette}=useAppTheme();const tint=tone==="success"?palette.success:tone==="error"?palette.danger:tone==="warning"?palette.warning:palette.brand;
 const bg=tone==="success"?palette.successSoft:tone==="error"?palette.dangerSoft:tone==="warning"?palette.warningSoft:palette.brandSoft;
 return <View style={{padding:12,borderRadius:13,backgroundColor:bg,borderColor:tint,borderWidth:StyleSheet.hairlineWidth}}><Text style={{color:tint,fontSize:11,fontWeight:"700",lineHeight:17}}>{text}</Text></View>;
}
export function State({title,body,retry}:{title:string;body:string;retry?:()=>void}){
 const {palette}=useAppTheme();return <Card style={{padding:22,alignItems:"center",gap:9}}><Text style={{color:palette.ink,fontWeight:"900",fontSize:14}}>{title}</Text><Text style={{color:palette.muted,textAlign:"center",fontSize:11,lineHeight:17}}>{body}</Text>{retry?<ActionButton small label="Try again" onPress={retry} variant="secondary"/>:null}</Card>;
}
const styles=StyleSheet.create({card:{borderWidth:StyleSheet.hairlineWidth,borderRadius:20,padding:14,gap:11},sectionHead:{flexDirection:"row",alignItems:"center",gap:10}});
