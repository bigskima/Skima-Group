import { View } from "react-native";
import { BillsAuthScreen } from "../src/screens/BillsAuthScreen";
import { BillsApp } from "../src/screens/BillsApp";
import { useSession } from "../src/session/SessionProvider";
import { useAppTheme } from "../src/theme/ThemeProvider";
import { ScreenSkeleton } from "../src/ui/ScreenSkeleton";
export default function Index(){
 const {status}=useSession();const {palette}=useAppTheme();
 if(status==="loading")return <View style={{flex:1,alignItems:"center",justifyContent:"center",backgroundColor:palette.canvas,padding:18,paddingTop:52}}><ScreenSkeleton variant="dashboard" cards={2}/></View>;
 return status==="authenticated"?<BillsApp/>:<BillsAuthScreen/>;
}
