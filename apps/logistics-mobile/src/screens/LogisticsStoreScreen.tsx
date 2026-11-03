import { useMemo, useState } from "react";
import { router } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Minus, Plus, Search, ShoppingBag, ShoppingCart, Store, X } from "lucide-react-native";
import { Alert, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { z } from "zod";
import { useLogisticsQuery, asString, asNumber } from "../api/logistics";
import { useLogisticsStorefrontData } from "../api/store";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { Screen } from "../ui/Screen";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { StatePanel } from "../ui/StatePanel";

type CartLine = { itemId: string; name: string; quantity: number; unitAmount: number; currencyCode: string };
const OrderSchema = z.union([z.string(), z.record(z.string(), z.unknown())]);
const money = (amount: number, currency: string) => new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
const idempotency = () => `logistics-store-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export function LogisticsStoreScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const queryClient = useQueryClient();
  const store = useLogisticsStorefrontData();
  const userId = session.context?.user.id ?? session.session?.user.id ?? "";
  const wallets = useLogisticsQuery(["store", "wallets"], "/runtime/wallets");
  const balances = useLogisticsQuery(["store", "wallet-balances"], "/runtime/wallet-balances");
  const locations = useLogisticsQuery(["store", "locations"], "/lpg/locations");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("delivery");
  const [locationId, setLocationId] = useState("");
  const [note, setNote] = useState("");
  const [checkoutKey, setCheckoutKey] = useState(idempotency());

  const customerWallet = (wallets.data ?? []).find((w) =>
    asString(w, "wallet_type") === "customer" &&
    asString(w, "owner_entity_type") === "user" &&
    asString(w, "owner_entity_id") === userId &&
    asString(w, "status") === "active",
  ) ?? null;
  const walletId = asString(customerWallet, "id");
  const currency = asString(customerWallet, "currency_code") ?? "NGN";
  const walletBalance = asNumber((balances.data ?? []).find((b) => asString(b, "wallet_id") === walletId), "balance") ?? 0;
  const availableLocations = (locations.data ?? []).filter((l) => !["inactive", "disabled", "deleted"].includes((asString(l, "status") ?? "").toLowerCase()));
  const products = useMemo(() => (store.items.data ?? []).filter((item) => asString(item, "status") === "active").map((item) => {
    const itemId = asString(item, "id") ?? "";
    const price = (store.prices.data ?? []).find((p) => asString(p, "item_id", "catalog_item_id") === itemId && asString(p, "status") === "active");
    const availability = (store.availability.data ?? []).find((a) => asString(a, "item_id", "catalog_item_id") === itemId);
    const amount = asNumber(price, "amount", "unit_amount", "price_amount") ?? asNumber(item, "price_amount", "unit_amount", "amount");
    return { item, id: itemId, name: asString(item, "display_name", "name", "title") ?? "Store item", description: asString(item, "description"), amount, currency: asString(price, "currency_code") ?? asString(item, "currency_code") ?? currency, stock: asNumber(availability, "available_quantity", "quantity_available", "stock_quantity") };
  }), [store.items.data, store.prices.data, store.availability.data, currency]);
  const activeCategories = (store.categories.data ?? []).filter((item) => asString(item, "status") === "active");
  const filtered = products.filter((p) => (category === "all" || asString(p.item, "category_id") === category || asString(p.item, "category_key") === category) && (`${p.name} ${p.description ?? ""}`.toLowerCase().includes(search.toLowerCase())));
  const cartTotal = cart.reduce((sum, line) => sum + line.unitAmount * line.quantity, 0);
  const cartCurrency = cart[0]?.currencyCode ?? currency;
  const hasCurrencyMismatch = cart.some((line) => line.currencyCode !== cartCurrency);
  const walletEnough = cartCurrency === currency && walletBalance >= cartTotal;
  const selectedLocation = availableLocations.find((l) => asString(l, "id") === locationId) ?? null;

  const checkout = useMutation({
    mutationFn: async () => {
      if (!walletId || !cart.length || !walletEnough || hasCurrencyMismatch || (fulfillment === "delivery" && !selectedLocation)) {
        throw new Error("Choose a funded customer wallet and an available fulfilment option.");
      }
      return session.api.post("/runtime/storefront/checkout", {
        lineItems: cart.map((line) => ({ itemId: line.itemId, variantId: null, quantity: line.quantity })),
        customerWalletId: walletId,
        fulfillmentMethod: fulfillment,
        deliveryLocationId: fulfillment === "delivery" ? locationId : null,
        customerNote: note.trim() || null,
        idempotencyKey: checkoutKey,
      }, OrderSchema);
    },
    onSuccess: async (result) => {
      const order = typeof result === "object" && result ? result : {};
      const orderId = typeof order.orderId === "string" ? order.orderId : typeof result === "string" ? result : "received";
      setCart([]); setNote(""); setCheckoutKey(idempotency());
      await Promise.all([wallets.refetch(), balances.refetch(), queryClient.invalidateQueries({ queryKey: ["skima-logistics", "store"] })]);
      Alert.alert("Order placed", `Your SKIMA Store order ${orderId === "received" ? "has been received" : `(${orderId.slice(0, 8).toUpperCase()}) is confirmed`}. The Store team can now prepare it.`);
    },
    onError: (error) => Alert.alert("Checkout failed", error instanceof Error ? error.message : "Please try again."),
  });

  function add(product: typeof products[number]) {
    if (product.amount === null || product.amount <= 0) return;
    if (product.stock !== null && product.stock < 1) return Alert.alert("Out of stock", "This item is currently unavailable.");
    const code = product.currency;
    setCart((current) => {
      const existing = current.find((line) => line.itemId === product.id);
      if (existing) return current.map((line) => line.itemId === product.id ? { ...line, quantity: line.quantity + 1 } : line);
      return [...current, { itemId: product.id, name: product.name, quantity: 1, unitAmount: product.amount!, currencyCode: code }];
    });
  }
  function changeQuantity(itemId: string, delta: number) {
    setCart((current) => current.map((line) => line.itemId === itemId ? { ...line, quantity: line.quantity + delta } : line).filter((line) => line.quantity > 0));
  }

  return (
    <Screen title="SKIMA Store" eyebrow="CUSTOMER STORE" subtitle="Shop available products from SKIMA." denseHeader>
      <Pressable onPress={() => router.back()} style={styles.back}><ArrowLeft color={palette.ink} size={17}/><Text style={[styles.backText,{color:palette.ink}]}>Back to Logistics</Text></Pressable>
      {store.modules.isPending || store.settings.isPending ? <ScreenSkeleton cards={2}/> : !store.storeModule || !store.activeSettings ? (
        <StatePanel title="Store is not available yet" description="The SKIMA Store catalogue will appear here when it is enabled." icon={<Store color={palette.brand} size={24}/>}/>
      ) : (
        <>
          <View style={styles.search}>
            <Search color={palette.muted} size={17}/>
            <TextInput value={search} onChangeText={setSearch} placeholder="Search products" placeholderTextColor={palette.muted} style={[styles.searchInput,{color:palette.ink}]}/>
            {search ? <Pressable onPress={()=>setSearch("")}><X color={palette.muted} size={17}/></Pressable> : null}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            <Filter label="All" active={category==="all"} onPress={()=>setCategory("all")}/>
            {activeCategories.map((item)=>{const id=asString(item,"id")??asString(item,"key")??"";return <Filter key={id} label={asString(item,"display_name","name")??"Category"} active={category===id} onPress={()=>setCategory(id)}/>;})}
          </ScrollView>
          {store.items.isPending || store.prices.isPending ? <ScreenSkeleton cards={3}/> : store.items.error || store.prices.error ? (
            <StatePanel title="Products could not load" description="Refresh the catalogue and try again." retry={()=>void Promise.all([store.items.refetch(),store.prices.refetch()])}/>
          ) : filtered.length ? (
            <View style={styles.productGrid}>
              {filtered.map((product)=>(
                <View key={product.id} style={[styles.product,{backgroundColor:palette.surface,borderColor:palette.border}]}>
                  <View style={[styles.productIcon,{backgroundColor:palette.brandSoft}]}><ShoppingBag color={palette.brand} size={23}/></View>
                  <Text style={[styles.productName,{color:palette.ink}]} numberOfLines={2}>{product.name}</Text>
                  {product.description ? <Text style={[styles.productDescription,{color:palette.muted}]} numberOfLines={2}>{product.description}</Text> : null}
                  <Text style={[styles.price,{color:palette.ink}]}>{product.amount !== null ? money(product.amount,product.currency) : "Price unavailable"}</Text>
                  <Pressable disabled={product.amount===null || (product.stock!==null && product.stock<1)} onPress={()=>add(product)} style={[styles.add,{backgroundColor:palette.brand,opacity:product.amount===null || (product.stock!==null && product.stock<1)?0.45:1}]}><Plus color="#fff" size={15}/><Text style={styles.addText}>Add</Text></Pressable>
                </View>
              ))}
            </View>
          ) : <StatePanel title="No matching products" description="Try another search or category."/>}
          <View style={[styles.cartPanel,{backgroundColor:palette.surface,borderColor:palette.border}]}>
            <View style={styles.cartHead}><View style={styles.cartTitleRow}><ShoppingCart color={palette.brand} size={19}/><Text style={[styles.cartTitle,{color:palette.ink}]}>Your basket ({cart.reduce((s,l)=>s+l.quantity,0)})</Text></View><Text style={[styles.cartTotal,{color:palette.ink}]}>{money(cartTotal,cartCurrency)}</Text></View>
            {cart.map((line)=><View key={line.itemId} style={styles.cartLine}><Text numberOfLines={1} style={[styles.cartName,{color:palette.ink}]}>{line.name}</Text><View style={styles.quantity}><Pressable onPress={()=>changeQuantity(line.itemId,-1)}><Minus color={palette.muted} size={16}/></Pressable><Text style={{color:palette.ink,fontWeight:"800"}}>{line.quantity}</Text><Pressable onPress={()=>changeQuantity(line.itemId,1)}><Plus color={palette.brand} size={16}/></Pressable></View><Text style={[styles.cartAmount,{color:palette.ink}]}>{money(line.unitAmount*line.quantity,line.currencyCode)}</Text></View>)}
            {cart.length ? (
              <>
                <View style={styles.options}>
                  <Filter label="Delivery" active={fulfillment==="delivery"} onPress={()=>setFulfillment("delivery")}/>
                  <Filter label="Pickup" active={fulfillment==="pickup"} onPress={()=>setFulfillment("pickup")}/>
                </View>
                {fulfillment==="delivery" ? (
                  <View style={styles.locationChoices}>
                    <Text style={[styles.formLabel,{color:palette.ink}]}>Delivery address</Text>
                    {availableLocations.length ? availableLocations.slice(0,5).map((loc)=>{const id=asString(loc,"id")??"";return <Pressable key={id} onPress={()=>setLocationId(id)} style={[styles.location,{borderColor:locationId===id?palette.brand:palette.border,backgroundColor:locationId===id?palette.brandSoft:palette.surface}]}><Text style={[styles.locationText,{color:palette.ink}]} numberOfLines={2}>{asString(loc,"display_name","formatted_address","address")??"Saved address"}</Text></Pressable>;}) : <Text style={[styles.productDescription,{color:palette.muted}]}>Add a delivery address in your SKIMA account or choose pickup.</Text>}
                  </View>
                ) : null}
                <TextInput value={note} onChangeText={setNote} placeholder="Order note (optional)" placeholderTextColor={palette.muted} style={[styles.note,{color:palette.ink,borderColor:palette.border}]}/>
                {!walletId ? <Text style={[styles.error,{color:palette.danger}]}>A SKIMA customer wallet is required.</Text> : !walletEnough ? <Text style={[styles.error,{color:palette.danger}]}>Insufficient balance in your {currency} customer wallet.</Text> : hasCurrencyMismatch ? <Text style={[styles.error,{color:palette.danger}]}>Your basket must use one currency.</Text> : null}
                <Pressable disabled={checkout.isPending || !walletId || !walletEnough || hasCurrencyMismatch || (fulfillment==="delivery" && !selectedLocation)} onPress={()=>checkout.mutate()} style={[styles.checkout,{backgroundColor:palette.brand,opacity:checkout.isPending?0.6:1}]}>{checkout.isPending ? <ActivityIndicator color="#fff"/> : <Text style={styles.checkoutText}>Pay {money(cartTotal,cartCurrency)}</Text>}</Pressable>
              </>
            ) : <Text style={[styles.productDescription,{color:palette.muted}]}>Add a product to your basket to continue.</Text>}
          </View>
        </>
      )}
    </Screen>
  );
}

function Filter({label,active,onPress}:{label:string;active:boolean;onPress:()=>void}){
  const {palette}=useAppTheme();
  return <Pressable onPress={onPress} style={[styles.filter,{backgroundColor:active?palette.brandSoft:palette.surface,borderColor:active?palette.brand:palette.border}]}><Text style={{color:active?palette.brand:palette.ink,fontSize:10,fontWeight:"800"}}>{label}</Text></Pressable>;
}
const styles=StyleSheet.create({
  back:{flexDirection:"row",alignItems:"center",gap:7,marginBottom:6},backText:{fontSize:11,fontWeight:"800"},
  search:{height:44,borderWidth:StyleSheet.hairlineWidth,borderColor:"#8885",borderRadius:radii.md,paddingHorizontal:12,flexDirection:"row",alignItems:"center",gap:8},
  searchInput:{flex:1,fontSize:13,paddingVertical:0},filters:{gap:7,paddingVertical:9},filter:{paddingHorizontal:12,paddingVertical:8,borderWidth:StyleSheet.hairlineWidth,borderRadius:radii.pill},
  productGrid:{flexDirection:"row",flexWrap:"wrap",gap:10},product:{width:"48.5%",minWidth:142,flexGrow:1,borderWidth:StyleSheet.hairlineWidth,borderRadius:radii.lg,padding:12,gap:7},
  productIcon:{width:52,height:52,borderRadius:15,alignItems:"center",justifyContent:"center"},productName:{...typography.bodyStrong,fontSize:12,lineHeight:16},
  productDescription:{...typography.caption,fontSize:10,lineHeight:14},price:{fontSize:13,fontWeight:"900"},
  add:{height:36,borderRadius:radii.md,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:5},addText:{color:"#fff",fontSize:11,fontWeight:"900"},
  cartPanel:{borderWidth:StyleSheet.hairlineWidth,borderRadius:radii.lg,padding:13,gap:10},cartHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},
  cartTitleRow:{flexDirection:"row",alignItems:"center",gap:7},cartTitle:{fontSize:13,fontWeight:"900"},cartTotal:{fontSize:15,fontWeight:"900"},
  cartLine:{flexDirection:"row",alignItems:"center",gap:8},cartName:{flex:1,fontSize:10,fontWeight:"700"},cartAmount:{fontSize:10,fontWeight:"800"},
  quantity:{flexDirection:"row",alignItems:"center",gap:9},options:{flexDirection:"row",gap:8},locationChoices:{gap:6},formLabel:{fontSize:11,fontWeight:"800"},
  location:{borderWidth:1,borderRadius:radii.md,padding:9},locationText:{fontSize:10,fontWeight:"700"},
  note:{minHeight:40,borderWidth:1,borderRadius:radii.md,paddingHorizontal:10,fontSize:11},error:{fontSize:10,fontWeight:"800"},
  checkout:{minHeight:44,borderRadius:radii.md,alignItems:"center",justifyContent:"center"},checkoutText:{color:"#fff",fontSize:12,fontWeight:"900"},
});
