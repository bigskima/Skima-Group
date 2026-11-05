import { ActivityIndicator, View } from "react-native";
import { BillsAuthScreen } from "../src/screens/BillsAuthScreen";
import { BillsApp } from "../src/screens/BillsApp";
import { useSession } from "../src/session/SessionProvider";
import { useAppTheme } from "../src/theme/ThemeProvider";
export default function Index(){
 const {status}=useSession();const {palette}=useAppTheme();
 if(status==="loading")return <View style={{flex:1,alignItems:"center",justifyContent:"center",backgroundColor:palette.canvas}}><ActivityIndicator color={palette.brand} size="large"/></View>;
 return status==="authenticated"?<BillsApp/>:<BillsAuthScreen/>;
}
