import type { ConfigContext, ExpoConfig } from "expo/config";
import { config as loadEnvironment } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
loadEnvironment({ path: resolve(__dirname, "../../.env"), override: false, quiet: true });
const brandImage = "./assets/skima-splash-logo.png";
const brandImagePath = resolve(__dirname, brandImage);
if (!existsSync(brandImagePath)) {
  throw new Error(`SKIMA native branding asset is missing: ${brandImagePath}`);
}
const easProjectId=process.env.EXPO_PUBLIC_BILLS_EAS_PROJECT_ID?.trim();
const googleServicesCandidate=process.env.SKIMA_BILLS_GOOGLE_SERVICES_FILE?.trim()||"./google-services.json";
const googleServicesFile=existsSync(resolve(__dirname,googleServicesCandidate))?googleServicesCandidate:undefined;
const androidPackage=process.env.SKIMA_BILLS_ANDROID_PACKAGE?.trim()||"com.skima.bills";
const iosBundleIdentifier=process.env.SKIMA_BILLS_IOS_BUNDLE_ID?.trim()||"com.skima.bills";
export default ({config}:ConfigContext):ExpoConfig=>({
 ...config,name:"SKIMA Bills",slug:"skima-bills",scheme:"skima-bills",version:"1.0.0",icon:brandImage,
 orientation:"default",userInterfaceStyle:"automatic",newArchEnabled:true,experiments:{typedRoutes:true},
 web:{bundler:"metro",output:"single",name:"SKIMA Bills",shortName:"SKIMA Bills",description:"Pay everyday bills and manage your SKIMA payment history.",themeColor:"#E21D2E",backgroundColor:"#FFFFFF",favicon:brandImage},
 android:{package:androidPackage,...(googleServicesFile?{googleServicesFile}:{}),adaptiveIcon:{foregroundImage:brandImage,backgroundColor:"#F7F7F8"},permissions:["POST_NOTIFICATIONS"]},
 ios:{bundleIdentifier:iosBundleIdentifier,supportsTablet:true},
 plugins:["expo-router","expo-secure-store",["expo-location",{locationWhenInUsePermission:"Allow SKIMA to check service updates that apply to your area."}],["expo-notifications",{defaultChannel:"bills",color:"#E21D2E",enableRemoteNotifications:true}],["expo-splash-screen",{image:brandImage,imageWidth:180,backgroundColor:"#F7F7F8",resizeMode:"contain",dark:{backgroundColor:"#111113",image:brandImage}}]],
 extra:{apiGatewayUrl:process.env.EXPO_PUBLIC_API_GATEWAY_URL,supabaseUrl:process.env.EXPO_PUBLIC_SUPABASE_URL,supabaseAnonKey:process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,billsBaseUrl:process.env.EXPO_PUBLIC_SKIMA_BILLS_BASE_URL,storeBaseUrl:process.env.EXPO_PUBLIC_SKIMA_STORE_BASE_URL,...(easProjectId?{eas:{projectId:easProjectId}}:{}),appIdentityStatus:easProjectId?"eas_project_configured":"eas_project_required"}
});
