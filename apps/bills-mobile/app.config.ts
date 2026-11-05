import type { ConfigContext, ExpoConfig } from "expo/config";
import { config as loadEnvironment } from "dotenv";
import { resolve } from "node:path";
loadEnvironment({ path: resolve(__dirname, "../../.env"), override: false, quiet: true });
const easProjectId=process.env.EXPO_PUBLIC_BILLS_EAS_PROJECT_ID?.trim();
const androidPackage=process.env.SKIMA_BILLS_ANDROID_PACKAGE?.trim()||"com.skima.bills";
const iosBundleIdentifier=process.env.SKIMA_BILLS_IOS_BUNDLE_ID?.trim()||"com.skima.bills";
export default ({config}:ConfigContext):ExpoConfig=>({
 ...config,name:"SKIMA Bills",slug:"skima-bills",scheme:"skima-bills",version:"1.0.0",icon:"./assets/skima-splash-logo.png",
 orientation:"default",userInterfaceStyle:"automatic",newArchEnabled:true,experiments:{typedRoutes:true},
 web:{bundler:"metro",output:"single",name:"SKIMA Bills",shortName:"SKIMA Bills",themeColor:"#E21D2F",backgroundColor:"#F7F7F8"},
 android:{package:androidPackage,adaptiveIcon:{foregroundImage:"./assets/skima-splash-logo.png",backgroundColor:"#F7F7F8"},permissions:["POST_NOTIFICATIONS"]},
 ios:{bundleIdentifier:iosBundleIdentifier,supportsTablet:true},
 plugins:["expo-router","expo-secure-store",["expo-notifications",{defaultChannel:"bills"}],["expo-splash-screen",{image:"./assets/skima-splash-logo.png",imageWidth:180,backgroundColor:"#F7F7F8",resizeMode:"contain",dark:{backgroundColor:"#111113",image:"./assets/skima-splash-logo.png"}}]],
 extra:{apiGatewayUrl:process.env.EXPO_PUBLIC_API_GATEWAY_URL,supabaseUrl:process.env.EXPO_PUBLIC_SUPABASE_URL,supabaseAnonKey:process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,billsBaseUrl:process.env.EXPO_PUBLIC_SKIMA_BILLS_BASE_URL,storeBaseUrl:process.env.EXPO_PUBLIC_SKIMA_STORE_BASE_URL,...(easProjectId?{eas:{projectId:easProjectId}}:{}),appIdentityStatus:easProjectId?"eas_project_configured":"eas_project_required"}
});
