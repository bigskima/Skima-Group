import { router } from "expo-router";
import { Eye, EyeOff, LockKeyhole, Mail, UserRound, ArrowLeft } from "lucide-react-native";
import { useState } from "react";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Linking from "expo-linking";
import { LinearGradient } from "expo-linear-gradient";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { useSession } from "../session/SessionProvider";
import { BillsBrandMark } from "../ui/BrandMark";

type Mode = "login" | "register" | "forgot" | "reset";
export function BillsAuthScreen({ initialMode = "login" }: { initialMode?: Mode }) {
  const session = useSession();
  const { palette, scheme } = useAppTheme();
  const [mode,setMode] = useState<Mode>(initialMode);
  const [name,setName] = useState("");
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [confirm,setConfirm] = useState("");
  const [visible,setVisible] = useState(false);
  const [pending,setPending] = useState(false);
  const [notice,setNotice] = useState("");
  const [success,setSuccess] = useState(false);
  const [confirmationEmail,setConfirmationEmail] = useState("");
  const resetUrl = Platform.OS === "web" ? Linking.createURL("reset-password") : "skima-bills://reset-password";

  const submit = async () => {
    if(pending) return;
    setPending(true);setNotice("");setSuccess(false);
    try {
      if(mode==="login") {
        const ok=await session.signIn(email,password);
        if(ok) router.replace("/");
        else setNotice(session.error || "Check your email and password and try again.");
      } else if(mode==="register") {
        const signUpRedirect = Platform.OS === "web" ? Linking.createURL("/") : "skima-bills://";
        const result=await session.signUp({displayName:name,email,password,redirectTo:signUpRedirect});
        setSuccess(true);
        setConfirmationEmail(result.confirmationRequired ? email.trim().toLowerCase() : "");
        setNotice(result.confirmationRequired ? "Your account has been created. Check your email to confirm it, then sign in." : "Your SKIMA account is ready.");
        if(result.sessionStarted) router.replace("/");
      } else if(mode==="forgot") {
        await session.requestPasswordReset(email,resetUrl);
        setSuccess(true);setNotice("If this email belongs to a SKIMA account, a secure reset link has been sent.");
      } else {
        if(password!==confirm) throw new Error("The passwords do not match.");
        await session.updatePassword(password);
        setSuccess(true);setNotice("Your password has been updated. Sign in with your new password.");
        setTimeout(()=>setMode("login"),700);
      }
    } catch(error) { setNotice(error instanceof Error?error.message:"We could not complete that request. Please try again."); }
    finally { setPending(false); }
  };

  const resendConfirmation = async () => {
    if (!confirmationEmail || pending) return;
    setPending(true);setNotice("");setSuccess(false);
    try {
      const confirmationUrl = Platform.OS === "web" ? Linking.createURL("/") : "skima-bills://";
      await session.resendSignupConfirmation(confirmationEmail, confirmationUrl);
      setSuccess(true);setNotice("A fresh confirmation email has been sent when the account is eligible.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The confirmation email could not be resent.");
    } finally { setPending(false); }
  };

  const title = mode==="login"?"Welcome to SKIMA Bills":mode==="register"?"Create your SKIMA account":mode==="forgot"?"Recover your account":"Set a new password";
  const subtitle = mode==="login"?"Your everyday payments, in one secure place.":mode==="register"?"One SKIMA account across your services.":mode==="forgot"?"Enter the email connected to your account.":"Choose a strong password for your account.";
  const canSubmit = mode==="register"?Boolean(name.trim()&&email.trim()&&password.length>=8):mode==="forgot"?Boolean(email.trim()):mode==="reset"?Boolean(password.length>=8&&confirm):Boolean(email.trim()&&password);

  return (
    <View style={[styles.root,{backgroundColor:scheme==="dark"?"#09090C":"#F7F7F8"}]}>
      <LinearGradient colors={scheme==="dark"?["#08090B","#1C0A10","#09090C"]:["#FFFFFF","#FFF6F7","#F4F4F6"]} style={StyleSheet.absoluteFill}/>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS==="ios"?"padding":undefined}>
        <ScrollView contentContainerStyle={styles.outer} keyboardShouldPersistTaps="handled">
          <View style={styles.shell}>
            <View style={styles.brandRow}>
              <BillsBrandMark size={48} />
              <View><Text style={[styles.brand,{color:palette.ink}]}>SKIMA</Text><Text style={[styles.brandSub,{color:palette.muted}]}>BILLS</Text></View>
            </View>
            <View style={[styles.card,{backgroundColor:palette.surface,borderColor:palette.border}]}>
              <View style={[styles.accent,{backgroundColor:palette.brand}]}/>
              {mode!=="login"&&mode!=="register"?<Pressable onPress={()=>setMode("login")} style={styles.back}><ArrowLeft color={palette.brand} size={18}/><Text style={{color:palette.brand,fontWeight:"800",fontSize:12}}>Back to sign in</Text></Pressable>:null}
              <Text style={[styles.eyebrow,{color:palette.brand}]}>SECURE CUSTOMER ACCOUNT</Text>
              <Text style={[styles.title,{color:palette.ink}]}>{title}</Text>
              <Text style={[styles.subtitle,{color:palette.muted}]}>{subtitle}</Text>
              <View style={styles.fields}>
                {mode==="register"?<Field label="Full name" value={name} onChangeText={setName} placeholder="Your name" icon={<UserRound size={17} color={palette.muted}/>}/>:null}
                {mode!=="reset"?<Field label="Email address" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" icon={<Mail size={17} color={palette.muted}/>}/>:null}
                {mode!=="forgot"?<Field label={mode==="reset"?"New password":"Password"} value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry={!visible} icon={<LockKeyhole size={17} color={palette.muted}/>} right={<Pressable onPress={()=>setVisible(!visible)}>{visible?<EyeOff size={18} color={palette.muted}/>:<Eye size={18} color={palette.muted}/>}</Pressable>}/>:null}
                {mode==="reset"?<Field label="Confirm password" value={confirm} onChangeText={setConfirm} placeholder="Enter password again" secureTextEntry={!visible} icon={<LockKeyhole size={17} color={palette.muted}/>}/>:null}
                {mode==="login"?<Pressable onPress={()=>setMode("forgot")} style={styles.forgot}><Text style={{color:palette.brand,fontWeight:"900",fontSize:11}}>Forgot password?</Text></Pressable>:null}
              </View>
              {confirmationEmail ? <Pressable onPress={() => void resendConfirmation()}><Text style={{color:palette.brand,fontSize:11,fontWeight:"900"}}>Resend confirmation email</Text></Pressable> : null}
              {notice? <View style={[styles.notice,{backgroundColor:success?palette.successSoft:palette.dangerSoft,borderColor:success?palette.success:palette.danger}]}><Text style={{color:success?palette.success:palette.danger,fontSize:12,lineHeight:18,fontWeight:"700"}}>{notice}</Text></View>:null}
              <Pressable disabled={!canSubmit||pending} onPress={()=>void submit()} style={{opacity:!canSubmit||pending?0.5:1}}>
                <LinearGradient colors={[colors.brand,"#F33C4E",colors.brandDark]} style={styles.submit}>
                  <Text style={styles.submitText}>{pending?"Please wait…":mode==="login"?"Sign in":mode==="register"?"Create account":mode==="forgot"?"Send reset link":"Update password"}</Text>
                </LinearGradient>
              </Pressable>
              {mode==="login"?<Text style={[styles.footer,{color:palette.muted}]}>New to SKIMA? <Text onPress={()=>{setNotice("");setMode("register");}} style={{color:palette.brand,fontWeight:"900"}}>Create an account</Text></Text>:mode==="register"?<Text style={[styles.footer,{color:palette.muted}]}>Already use SKIMA? <Text onPress={()=>{setNotice("");setMode("login");}} style={{color:palette.brand,fontWeight:"900"}}>Sign in</Text></Text>:null}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field(props: {label:string;value:string;onChangeText:(value:string)=>void;placeholder:string;icon:ReactNode;right?:React.ReactNode;secureTextEntry?:boolean;keyboardType?:"email-address"|"default";autoCapitalize?:"none"|"sentences"}) {
  const {palette}=useAppTheme();
  const [focused,setFocused]=useState(false);
  return <View style={{gap:7}}>
    <Text style={{color:palette.mutedStrong,fontSize:11,fontWeight:"900"}}>{props.label}</Text>
    <View style={[styles.input,{backgroundColor:palette.input,borderColor:focused?palette.brand:palette.border}]}>
      {props.icon}
      <TextInput value={props.value} onChangeText={props.onChangeText} placeholder={props.placeholder} placeholderTextColor={palette.muted} onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)} secureTextEntry={props.secureTextEntry} keyboardType={props.keyboardType??"default"} autoCapitalize={props.autoCapitalize??"sentences"} autoCorrect={false} style={{flex:1,color:palette.ink,fontSize:14,minHeight:48}}/>
      {props.right}
    </View>
  </View>;
}

const styles=StyleSheet.create({
 root:{flex:1},fill:{flex:1},outer:{flexGrow:1,alignItems:"center",justifyContent:"center",padding:20,paddingVertical:32},
 shell:{width:"100%",maxWidth:460,gap:20},brandRow:{flexDirection:"row",alignItems:"center",gap:10},
 brand:{fontSize:15,fontWeight:"900",letterSpacing:1},brandSub:{fontSize:9,fontWeight:"900",letterSpacing:1.5},
 card:{borderWidth:1,borderRadius:30,padding:24,gap:15,overflow:"hidden"},accent:{height:3,width:44,borderRadius:4,marginBottom:5},
 eyebrow:{fontSize:9,fontWeight:"900",letterSpacing:1.1},title:{fontSize:29,fontWeight:"900",letterSpacing:-.8},subtitle:{fontSize:13,lineHeight:19},
 fields:{gap:13},input:{minHeight:56,borderRadius:15,borderWidth:1,paddingHorizontal:13,flexDirection:"row",alignItems:"center",gap:10},
 forgot:{alignSelf:"flex-end",paddingVertical:2},notice:{padding:12,borderRadius:13,borderWidth:1},
 submit:{minHeight:54,borderRadius:16,alignItems:"center",justifyContent:"center"},submitText:{color:"#fff",fontSize:14,fontWeight:"900"},
 footer:{textAlign:"center",fontSize:11,fontWeight:"700"},privacy:{textAlign:"center",fontSize:10,fontWeight:"600"},
 back:{flexDirection:"row",alignItems:"center",gap:6,paddingBottom:4}
});
