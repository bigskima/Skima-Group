import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Minus, Plus, Search, ShoppingBag, ShoppingCart, Store, X } from "lucide-react-native";
import { Alert, ActivityIndicator, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { z } from "zod";
import { useLogisticsQuery, asString, asNumber } from "../api/logistics";
import { useLogisticsStorefrontData } from "../api/store";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, typography } from "../theme/tokens";
import { Screen } from "../ui/Screen";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { StatePanel } from "../ui/StatePanel";

type CartLine = { itemId: string; variantId: string | null; name: string; variantName: string | null; quantity: number; unitAmount: number; currencyCode: string };
type ProductMedia = { assetId: string; mediaType: "image" | "video"; displayOrder: number };
type Product = { item: Record<string, unknown>; id: string; variantId: string | null; name: string; variantName: string | null; description: string | null; amount: number; compareAtAmount: number | null; currency: string; stock: number | null; imageAssetId: string | null; media: ProductMedia[] };
const OrderSchema = z.union([z.string(), z.record(z.string(), z.unknown())]);
const MediaReadSchema = z.object({ assetId:z.string(), contentType:z.string().nullable(), expiresInSeconds:z.number().positive(), signedUrl:z.string().url() });
const money = (amount: number, currency: string) => new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
const idempotency = () => `logistics-store:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const effective = (value: Record<string, unknown>, now: number) => {
  const from = typeof value.effective_from === "string" ? Date.parse(value.effective_from) : null;
  const until = typeof value.effective_until === "string" ? Date.parse(value.effective_until) : null;
  return (from === null || !Number.isFinite(from) || from <= now) && (until === null || !Number.isFinite(until) || until > now);
};
const metadataValue = (value: Record<string, unknown>, key: string) => record(value.metadata)[key];
export function LogisticsStoreScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const params = useLocalSearchParams<{ itemId?: string | string[] }>();
  const requestedItemId = Array.isArray(params.itemId) ? params.itemId[0] : params.itemId;
  const { width } = useWindowDimensions();
  const queryClient = useQueryClient();
  const store = useLogisticsStorefrontData();
  const userId = session.context?.user.id ?? session.session?.user.id ?? "";
  const wallets = useLogisticsQuery(["store", "wallets"], "/runtime/wallets");
  const balances = useLogisticsQuery(["store", "wallet-balances"], "/runtime/wallet-balances");
  const locations = useLogisticsQuery(["store", "locations"], "/lpg/locations");
  const storeOrders = useLogisticsQuery(["store", "orders"], "/runtime/storefront/orders", true, 15_000);
  const cartStorageKey = `skima:logistics:store:v1:${userId}:${asString(store.storeModule,"id")??"pending"}`;
  const [cartReady,setCartReady]=useState(false);
  const [loadedCartKey,setLoadedCartKey]=useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("delivery");
  const [locationId, setLocationId] = useState("");
  const [note, setNote] = useState("");
  const [checkoutKey, setCheckoutKey] = useState(idempotency());

  const confirmReceipt = useMutation({
    mutationFn: async (orderId: string) => session.api.post(
      "/runtime/storefront/orders/confirm-receipt",
      { orderId, idempotencyKey: `logistics-store-receipt:${orderId}` },
      z.record(z.string(), z.unknown()),
    ),
    onSuccess: async () => {
      await Promise.all([
        storeOrders.refetch(),
        wallets.refetch(),
        balances.refetch(),
      ]);
      Alert.alert("Receipt confirmed", "Your Store receipt has been recorded and the order settlement is complete.");
    },
  });

  useEffect(()=>{
    let active=true;
    setCartReady(false);
    void AsyncStorage.getItem(cartStorageKey).then((saved)=>{
      if(!active) return;
      if(saved){
        const parsed:unknown=JSON.parse(saved);
        setCart(Array.isArray(parsed)?parsed.filter(isCartLine):[]);
      }else setCart([]);
    }).catch(()=>{if(active)setCart([]);}).finally(()=>{
      if(active){setLoadedCartKey(cartStorageKey);setCartReady(true);}
    });
    return()=>{active=false;};
  },[cartStorageKey]);
  useEffect(()=>{
    if(!cartReady||loadedCartKey!==cartStorageKey) return;
    void AsyncStorage.setItem(cartStorageKey,JSON.stringify(cart)).catch(()=>undefined);
  },[cart,cartReady,cartStorageKey,loadedCartKey]);

  const settings = store.activeSettings;
  const storeModuleId = asString(store.storeModule, "id");
  const currency = asString(settings, "currency_code") ?? "NGN";
  const customerWallet = (wallets.data ?? []).find((wallet) =>
    asString(wallet,"wallet_type")==="customer" &&
    asString(wallet,"owner_entity_type")==="user" &&
    asString(wallet,"owner_entity_id")===userId &&
    asString(wallet,"currency_code")===currency &&
    asString(wallet,"status")==="active"
  ) ?? null;
  const walletId = asString(customerWallet,"id");
  const walletBalance = asNumber((balances.data??[]).find((balance)=>asString(balance,"wallet_id")===walletId),"balance") ?? 0;
  const availableLocations = (locations.data ?? []).filter((location)=>!["inactive","disabled","deleted"].includes((asString(location,"status")??"").toLowerCase()));
  const configuredMethods = Array.isArray(settings?.fulfillment_methods) ? settings.fulfillment_methods.filter((method):method is "delivery"|"pickup"=>method==="delivery"||method==="pickup") : [];
  const allowedMethods = configuredMethods.length ? configuredMethods : (settings?.fulfillment_method==="pickup" ? ["pickup" as const] : ["delivery" as const,"pickup" as const]);

  useEffect(()=>{
    if(!allowedMethods.includes(fulfillment)) setFulfillment(allowedMethods[0] ?? "delivery");
  },[allowedMethods.join("|"),fulfillment]);
  useEffect(()=>{
    if(!locationId && availableLocations.length){
      const preferred=availableLocations.find((location)=>location.is_default===true)??availableLocations[0];
      setLocationId(asString(preferred,"id")??"");
    }
  },[availableLocations,locationId]);

  const products = useMemo<Product[]>(()=>{
    if(!settings || !storeModuleId) return [];
    const now=Date.now();
    const output:Product[]=[];
    for(const item of store.items.data??[]){
      const itemId=asString(item,"id")??"";
      if(!itemId || asString(item,"module_id")!==storeModuleId ||
        asString(item,"organization_id")!==asString(settings,"organization_id") ||
        asString(item,"status")!=="active" || metadataValue(item,"sales_channel")!=="skima_store") continue;
      const methods=Array.isArray(item.fulfillment_methods)?item.fulfillment_methods.filter((v):v is string=>typeof v==="string"):[];
      if(methods.length && !allowedMethods.some((method)=>methods.includes(method))) continue;
      const variants=(store.variants.data??[]).filter((variant)=>asString(variant,"item_id")===itemId && asString(variant,"status")==="active");
      const prices=(store.prices.data??[]).filter((price)=>asString(price,"item_id")===itemId && asString(price,"currency_code")===currency && asString(price,"status")==="active" && effective(price,now));
      const stockRules=(store.availability.data??[]).filter((rule)=>asString(rule,"item_id")===itemId && asString(rule,"status")==="active" && effective(rule,now));
      const choices=variants.length?variants:[null];
      for(const variant of choices){
        const variantId=variant?asString(variant,"id"):null;
        const price=prices.find((entry)=>(asString(entry,"variant_id")??null)===variantId) ?? prices.find((entry)=>!asString(entry,"variant_id"));
        const stock=stockRules.find((entry)=>(asString(entry,"variant_id")??null)===variantId) ?? stockRules.find((entry)=>!asString(entry,"variant_id"));
        if(!price || !stock || asString(stock,"availability_status")!=="available") continue;
        const amount=asNumber(price,"amount","unit_amount","price_amount");
        if(amount===null || amount<=0) continue;
        const quantity=asNumber(stock,"stock_quantity");
        const reserved=asNumber(stock,"reserved_quantity")??0;
        const remaining=quantity===null?null:Math.max(0,quantity-reserved);
        if(remaining!==null && remaining<=0) continue;
        output.push({
          item,id:itemId,variantId,
          name:asString(item,"display_name","name","title")??"Store item",
          variantName:variant?asString(variant,"display_name","name","label"):null,
          description:asString(item,"description"),amount,compareAtAmount:asNumber(price,"compare_at_amount"),currency,stock:remaining,
          imageAssetId:asString((store.media.data??[]).filter((media)=>asString(media,"item_id")===itemId&&asString(media,"status")==="active"&&metadataValue(media,"mediaType")!=="video").sort((left,right)=>(asNumber(left,"display_order")??0)-(asNumber(right,"display_order")??0))[0],"media_asset_id"),
          media:(store.media.data??[])
            .filter((media)=>asString(media,"item_id")===itemId&&asString(media,"status")==="active")
            .sort((left,right)=>(asNumber(left,"display_order")??0)-(asNumber(right,"display_order")??0))
            .flatMap((media)=>{const assetId=asString(media,"media_asset_id");return assetId?[{assetId,mediaType:metadataValue(media,"mediaType")==="video"?"video" as const:"image" as const,displayOrder:asNumber(media,"display_order")??0}]:[]})
        });
      }
    }
    return output;
  },[settings,storeModuleId,store.items.data,store.variants.data,store.prices.data,store.availability.data,store.media.data,allowedMethods.join("|"),currency]);

  const activeCategories=(store.categories.data??[]).filter((item)=>asString(item,"status")==="active" && asString(item,"module_id")===storeModuleId);
  const filtered=products.filter((product)=>(category==="all" || asString(product.item,"category_id")===category) && `${product.name} ${product.variantName??""} ${product.description??""}`.toLowerCase().includes(search.trim().toLowerCase()));
  useEffect(()=>{
    if(!requestedItemId || store.items.isPending) return;
    const requestedProduct=filtered.find((product)=>product.id===requestedItemId);
    if(requestedProduct && selectedProduct?.id!==requestedItemId) setSelectedProduct(requestedProduct);
  },[requestedItemId,store.items.isPending,filtered,selectedProduct?.id]);

  function closeSelectedProduct(){
    setSelectedProduct(null);
    if(requestedItemId) router.replace("/(customer)/store" as never);
  }
  const cartTotal=cart.reduce((sum,line)=>sum+line.unitAmount*line.quantity,0);
  const cartCurrency=cart[0]?.currencyCode??currency;
  const flatDeliveryFee=asNumber(settings,"delivery_base_fee_amount")??0;
  const deliveryEtaMin=asNumber(settings,"delivery_eta_min_business_days")??2;
  const deliveryEtaMax=asNumber(settings,"delivery_eta_max_business_days")??5;
  const freeMinimum=asNumber(settings,"free_delivery_minimum_amount");
  const deliveryFee=fulfillment==="pickup"?0:freeMinimum!==null && cartTotal>=freeMinimum?0:flatDeliveryFee;
  const minimumOrder=asNumber(settings,"minimum_order_amount")??0;
  const total=cartTotal+deliveryFee;
  const walletEnough=cartCurrency===currency && total!==null && walletBalance>=total;
  const currenciesMatch=cart.every((line)=>line.currencyCode===currency);
  const canCheckout=Boolean(settings&&cartReady&&walletId&&cart.length&&walletEnough&&currenciesMatch&&total>0&&cartTotal>=minimumOrder&&(fulfillment==="pickup"||Boolean(locationId)));

  const checkout=useMutation({
    mutationFn:async()=>{
      if(!canCheckout) throw new Error("Choose a configured delivery option, an available address and a funded SKIMA Wallet before continuing.");
      return session.api.post("/runtime/storefront/checkout",{
        lineItems:cart.map((line)=>({itemId:line.itemId,variantId:line.variantId,quantity:line.quantity})),
        customerWalletId:walletId,fulfillmentMethod:fulfillment,
        deliveryLocationId:fulfillment==="delivery"?locationId:null,
        customerNote:note.trim()||null,idempotencyKey:checkoutKey
      },OrderSchema);
    },
    onSuccess:async(result)=>{
      const order=record(result);const orderId=asString(order,"orderId")??(typeof result==="string"?result:"received");
      setCart([]);setNote("");setCheckoutKey(idempotency());
      await Promise.all([wallets.refetch(),balances.refetch(),queryClient.invalidateQueries({queryKey:["skima-logistics","store"]})]);
      Alert.alert("Payment reserved",`Your SKIMA Store order ${orderId==="received"?"has been received":`(${orderId.slice(0,8).toUpperCase()}) is confirmed`}. ${money(total??cartTotal,currency)} has been reserved in SKIMA checkout escrow.`);
    },
    onError:(error)=>{
      const message=error instanceof Error?error.message:"Please review your basket and try again.";
      if(/checkout_order_closed|outside_delivery_area|delivery_coordinates_required|invalid_checkout_snapshot|insufficient_wallet_balance/i.test(message)) setCheckoutKey(idempotency());
      Alert.alert("Checkout failed",message);
    }
  });

  function add(product:Product){
    setCart(current=>{
      const existing=current.find((line)=>line.itemId===product.id&&line.variantId===product.variantId);
      if(existing) return current.map((line)=>line.itemId===product.id&&line.variantId===product.variantId?{...line,quantity:product.stock===null?line.quantity+1:Math.min(product.stock,line.quantity+1)}:line);
      return [...current,{itemId:product.id,variantId:product.variantId,name:product.name,variantName:product.variantName,quantity:1,unitAmount:product.amount,currencyCode:product.currency}];
    });
  }
  function changeQuantity(itemId:string,variantId:string|null,delta:number){
    setCart(current=>current.map(line=>line.itemId===itemId&&line.variantId===variantId?{...line,quantity:Math.max(0,line.quantity+delta)}:line).filter(line=>line.quantity>0));
  }

  return (
    <Screen title="SKIMA Store" denseHeader>
      <Pressable onPress={()=>router.back()} style={styles.back}><ArrowLeft color={palette.ink} size={17}/><Text style={[styles.backText,{color:palette.ink}]}>Back to Logistics</Text></Pressable>
      {store.modules.isPending||store.settings.isPending? <ScreenSkeleton cards={2}/> : !store.storeModule||!settings? (
        <StatePanel title="Store is not available" description="SKIMA Store will appear here when the platform enables it." icon={<Store color={palette.brand} size={23}/>}/>
      ) : (
        <>
          <View style={[styles.hero,{backgroundColor:palette.surface,borderColor:palette.border}]}>
        <View style={styles.heroCopy}>
          <Text style={[styles.heroEyebrow,{color:palette.brand}]}>SKIMA STORE</Text>
          <Text style={[styles.heroTitle,{color:palette.ink}]}>Shop essentials.</Text>
          <Text style={[styles.heroBody,{color:palette.muted}]}>Cylinders and more, all in one store.</Text>
        </View>
        <View style={[styles.heroIcon,{backgroundColor:palette.brandSoft}]}><ShoppingBag color={palette.brand} size={29}/></View>
      </View>
      <View style={[styles.toolbar,{borderColor:palette.border,backgroundColor:palette.surface}]}>
            <View style={styles.search}><Search color={palette.muted} size={16}/><TextInput value={search} onChangeText={setSearch} placeholder="Search products" placeholderTextColor={palette.muted} style={[styles.searchInput,{color:palette.ink}]}/>{search?<Pressable onPress={()=>setSearch("")}><X color={palette.muted} size={16}/></Pressable>:null}</View>
            <View style={styles.walletPill}><ShoppingBag color={palette.brand} size={14}/><Text style={{color:palette.ink,fontSize:10,fontWeight:"800"}}>{walletId?money(walletBalance,currency):"Wallet unavailable"}</Text></View>
          </View>
          <View style={styles.sectionHead}>
            <View><Text style={[styles.sectionTitle,{color:palette.ink}]}>Shop by category</Text><Text style={[styles.sectionSubtitle,{color:palette.muted}]}>Browse active Store sections</Text></View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            <Filter label="All products" active={category==="all"} onPress={()=>setCategory("all")}/>
            {activeCategories.map((item)=>{const id=asString(item,"id")??asString(item,"key")??"";return <Filter key={id} label={asString(item,"display_name","name")??"Category"} active={category===id} onPress={()=>setCategory(id)}/>;})}
          </ScrollView>
          {store.items.isPending||store.prices.isPending||store.availability.isPending? <ScreenSkeleton cards={3}/> :
           store.items.error||store.prices.error||store.availability.error? <StatePanel title="Products could not load" description="Refresh the catalogue and try again." retry={()=>void Promise.all([store.items.refetch(),store.prices.refetch(),store.availability.refetch()])}/> :
           <>
           <View style={styles.sectionHead}>
             <View><Text style={[styles.sectionTitle,{color:palette.ink}]}>{category==="all"?"Shop all products":asString(activeCategories.find(item=>(asString(item,"id")??asString(item,"key"))===category),"display_name","name")??"Products"}</Text><Text style={[styles.sectionSubtitle,{color:palette.muted}]}>{filtered.length} product{filtered.length===1?"":"s"} available</Text></View>
           </View>
           {filtered.length ? (
              <View style={styles.grid}>
                {filtered.map((product) => {
                  const categoryLabel =
                    asString(product.item, "category_name", "categoryName", "category") ??
                    asString(
                      activeCategories.find(
                        (item) => (asString(item, "id") ?? asString(item, "key")) ===
                          asString(product.item, "category_id"),
                      ),
                      "display_name",
                      "name",
                    ) ?? "General";
                  const discountPercent =
                    product.compareAtAmount !== null && product.compareAtAmount > product.amount
                      ? Math.round((product.compareAtAmount - product.amount) / product.compareAtAmount * 100)
                      : 0;
                  return (
                    <View
                      key={`${product.id}:${product.variantId ?? "base"}`}
                      style={[
                        styles.product,
                        {
                          width: width >= 1100 ? "23.5%" : width >= 700 ? "31.5%" : "48.5%",
                          backgroundColor: palette.surface,
                          borderColor: palette.border,
                        },
                      ]}
                    >
                      <View style={styles.productMedia}>
                        <ProductImage assetId={product.imageAssetId} label={product.name} />
                        {discountPercent > 0 ? (
                          <View style={[styles.discountBadge, { backgroundColor: palette.brand }]}>
                            <Text style={styles.discountText}>{discountPercent}% OFF</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={[styles.productCategory, { color: palette.muted }]} numberOfLines={1}>
                        {categoryLabel}
                      </Text>
                      <Pressable
                        onPress={() => router.push({
                          pathname: "/(customer)/store",
                          params: { itemId: product.id },
                        } as never)}
                      >
                        <Text style={[styles.productName, { color: palette.ink }]} numberOfLines={2}>
                          {product.name}
                        </Text>
                      </Pressable>
                      {product.variantName ? (
                        <Text style={[styles.productDescription, { color: palette.muted }]} numberOfLines={1}>
                          {product.variantName}
                        </Text>
                      ) : null}
                      <View style={styles.priceRow}>
                        <Text style={[styles.price, { color: palette.ink }]}>{money(product.amount, product.currency)}</Text>
                        {product.compareAtAmount !== null && product.compareAtAmount > product.amount ? (
                          <Text style={[styles.comparePrice, { color: palette.muted }]}>
                            {money(product.compareAtAmount, product.currency)}
                          </Text>
                        ) : null}
                      </View>
                      <Pressable onPress={() => add(product)} style={[styles.add, { backgroundColor: palette.brand }]}>
                        <Plus color="#fff" size={15} />
                        <Text style={styles.addText}>Add to basket</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            ) : (
              <StatePanel
                title="No available products"
                description="Active Store products with a valid price and available stock will appear here."
              />
            )}
           </>}
          {cart.length? <View style={[styles.cartPanel,{backgroundColor:palette.surface,borderColor:palette.border}]}>
            <View style={styles.cartHead}><View style={styles.cartTitleRow}><ShoppingCart color={palette.brand} size={18}/><Text style={[styles.cartTitle,{color:palette.ink}]}>Basket ({cart.reduce((sum,line)=>sum+line.quantity,0)})</Text></View><Text style={[styles.cartTotal,{color:palette.ink}]}>{money(cartTotal,cartCurrency)}</Text></View>
            {cart.map(line=><View key={`${line.itemId}:${line.variantId??"base"}`} style={styles.cartLine}><View style={{flex:1,minWidth:0}}><Text numberOfLines={1} style={[styles.cartName,{color:palette.ink}]}>{line.name}</Text>{line.variantName?<Text style={[styles.productDescription,{color:palette.muted}]}>{line.variantName}</Text>:null}</View><View style={styles.quantity}><Pressable onPress={()=>changeQuantity(line.itemId,line.variantId,-1)}><Minus color={palette.muted} size={15}/></Pressable><Text style={{color:palette.ink,fontWeight:"800"}}>{line.quantity}</Text><Pressable onPress={()=>changeQuantity(line.itemId,line.variantId,1)}><Plus color={palette.brand} size={15}/></Pressable></View><Text style={[styles.cartAmount,{color:palette.ink}]}>{money(line.unitAmount*line.quantity,line.currencyCode)}</Text></View>)}
            {cart.length?<>
              <View style={styles.options}>{allowedMethods.includes("delivery")?<Filter label="Delivery" active={fulfillment==="delivery"} onPress={()=>setFulfillment("delivery")}/>:null}{allowedMethods.includes("pickup")?<Filter label="Pickup" active={fulfillment==="pickup"} onPress={()=>setFulfillment("pickup")}/>:null}</View>
              {fulfillment==="delivery"?<View style={styles.locationChoices}><Text style={[styles.formLabel,{color:palette.ink}]}>Delivery address</Text>{availableLocations.length?availableLocations.slice(0,6).map(location=>{const id=asString(location,"id")??"";return <Pressable key={id} onPress={()=>setLocationId(id)} style={[styles.location,{borderColor:locationId===id?palette.brand:palette.border,backgroundColor:locationId===id?palette.brandSoft:palette.surface}]}><Text style={[styles.locationText,{color:palette.ink}]} numberOfLines={2}>{asString(location,"formatted_address","display_name","address")??"Saved address"}</Text></Pressable>;}) : <Text style={[styles.productDescription,{color:palette.muted}]}>Add a saved address or choose pickup.</Text>}</View>:null}
              <TextInput value={note} onChangeText={setNote} placeholder="Order note (optional)" placeholderTextColor={palette.muted} style={[styles.note,{color:palette.ink,borderColor:palette.border}]}/>
              {fulfillment==="delivery"?<Text style={[styles.productDescription,{color:palette.muted}]}>Flat delivery fee: {money(deliveryFee,currency)}</Text>:null}
              {fulfillment==="delivery"?<Text style={[styles.productDescription,{color:palette.muted}]}>Estimated delivery: {deliveryEtaMin===deliveryEtaMax?`${deliveryEtaMin} business days`:`${deliveryEtaMin}–${deliveryEtaMax} business days`} after SKIMA accepts your order and confirms it can serve your address.</Text>:null}
              <Pressable onPress={()=>router.push("/(customer)/wallet" as never)}><Text style={[styles.productDescription,{color:palette.brand,fontWeight:"800"}]}>View shared SKIMA Wallet · Add funds</Text></Pressable>
              {!walletId?<Text style={[styles.error,{color:palette.danger}]}>Your shared SKIMA customer wallet is unavailable.</Text>:!walletEnough?<Text style={[styles.error,{color:palette.danger}]}>Your {currency} customer wallet cannot cover this order and delivery.</Text>:cartTotal<minimumOrder?<Text style={[styles.error,{color:palette.danger}]}>Minimum order: {money(minimumOrder,currency)}.</Text>:null}
              {fulfillment==="delivery"?<Text style={[styles.productDescription,{color:palette.muted}]}>Orders are accepted nationwide in Nigeria. SKIMA Store reviews serviceability after checkout; locations we cannot serve will be cancelled and refunded.</Text>:null}
              <Pressable disabled={checkout.isPending||!cartReady||!canCheckout} onPress={()=>checkout.mutate()} style={[styles.checkout,{backgroundColor:palette.brand,opacity:checkout.isPending||!cartReady||!canCheckout?0.5:1}]}>{checkout.isPending?<ActivityIndicator color="#fff"/>:<Text style={styles.checkoutText}>Pay {money(total??cartTotal,currency)}</Text>}</Pressable>
            </>:<Text style={[styles.productDescription,{color:palette.muted}]}>Add a product to your basket to continue.</Text>}
          </View> : null}
          <View style={styles.sectionHead}>
            <View><Text style={[styles.sectionTitle,{color:palette.ink}]}>Your Store orders</Text><Text style={[styles.sectionSubtitle,{color:palette.muted}]}>Track fulfilment and confirm receipt</Text></View>
          </View>
          {storeOrders.isPending ? <ScreenSkeleton cards={1}/> : storeOrders.error ? (
            <StatePanel title="Store orders could not load" description="Refresh to check your purchase status." retry={()=>void storeOrders.refetch()}/>
          ) : (storeOrders.data??[]).length ? (storeOrders.data??[]).slice(0,5).map(order=>{
            const orderId=asString(order,"id")??"";
            const status=asString(order,"status")??"received";
            const payload=record(order.order_payload);
            const snapshot=record(payload.store_checkout_snapshot);
            const etaMin=asNumber(snapshot,"deliveryEtaMinBusinessDays","delivery_eta_min_business_days");
            const etaMax=asNumber(snapshot,"deliveryEtaMaxBusinessDays","delivery_eta_max_business_days");
            return <View key={orderId} style={[styles.cartPanel,{backgroundColor:palette.surface,borderColor:palette.border}]}>
              <View style={styles.cartHead}>
                <Text style={[styles.cartTitle,{color:palette.ink}]}>Order {orderId.slice(0,8).toUpperCase()}</Text>
                <Text style={[styles.productDescription,{color:palette.brand,fontWeight:"900"}]}>{status.replace(/[_-]+/g," ")}</Text>
              </View>
              <Text style={[styles.productDescription,{color:palette.muted}]}>
                {fulfillmentLabel(asString(order,"fulfillment_method")??"delivery")} · {money(asNumber(order,"total_amount")??0,asString(order,"currency_code")??currency)}
              </Text>
              {etaMin!==null && etaMax!==null && asString(order,"status")!=="completed" ? (
                <Text style={[styles.productDescription,{color:palette.muted}]}>
                  Estimated delivery: {etaMin===etaMax?`${etaMin} business days`:`${etaMin}–${etaMax} business days`} after order acceptance
                </Text>
              ):null}
              {status==="fulfilled" ? <Pressable disabled={confirmReceipt.isPending} onPress={()=>confirmReceipt.mutate(orderId)} style={[styles.checkout,{backgroundColor:palette.brand,opacity:confirmReceipt.isPending?0.55:1}]}>
                {confirmReceipt.isPending?<ActivityIndicator color="#fff"/>:<Text style={styles.checkoutText}>I have received my items</Text>}
              </Pressable> : status==="completed" ? <Text style={[styles.productDescription,{color:palette.success,fontWeight:"800"}]}>Receipt confirmed · settlement completed</Text> : null}
            </View>;
          }) : <StatePanel title="No Store orders yet" description="Your Store purchases and delivery updates will appear here."/>}
          {confirmReceipt.error ? <Text style={[styles.error,{color:palette.danger}]}>{confirmReceipt.error.message}</Text> : null}
        </>
      )}
      <Modal transparent animationType="slide" visible={Boolean(selectedProduct)} onRequestClose={closeSelectedProduct}>
        <View style={styles.detailBackdrop}>
          <View style={[styles.detailPanel,{backgroundColor:palette.surface}]}>
            <View style={styles.detailHandle}/>
            <View style={styles.detailHeader}>
              <View style={{flex:1,minWidth:0}}>
                <Text style={[styles.detailTitle,{color:palette.ink}]}>{selectedProduct?.name??"Product details"}</Text>
                {selectedProduct?.variantName?<Text style={[styles.productDescription,{color:palette.muted}]}>{selectedProduct.variantName}</Text>:null}
              </View>
              <Pressable onPress={closeSelectedProduct} style={[styles.detailClose,{backgroundColor:palette.brandSoft}]}><X color={palette.ink} size={19}/></Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{gap:12,paddingBottom:12}}>
              {selectedProduct?.media.length?(
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:9}}>
                  {selectedProduct.media.map(media=><StoreProductMedia key={media.assetId} assetId={media.assetId} label={selectedProduct.name} isVideo={media.mediaType==="video"}/>)}
                </ScrollView>
              ):selectedProduct?<ProductImage assetId={selectedProduct.imageAssetId} label={selectedProduct.name}/>:null}
              {selectedProduct?.description?<Text style={[styles.detailDescription,{color:palette.muted}]}>{selectedProduct.description}</Text>:null}
              {selectedProduct?<View style={styles.priceRow}><Text style={[styles.price,{color:palette.ink}]}>{money(selectedProduct.amount,selectedProduct.currency)}</Text>{selectedProduct.compareAtAmount!==null&&selectedProduct.compareAtAmount>selectedProduct.amount?<Text style={[styles.comparePrice,{color:palette.muted}]}>{money(selectedProduct.compareAtAmount,selectedProduct.currency)}</Text>:null}</View>:null}
              {selectedProduct?<Pressable onPress={()=>{add(selectedProduct);closeSelectedProduct();}} style={[styles.add,{backgroundColor:palette.brand,height:44}]}><Plus color="#fff" size={16}/><Text style={styles.addText}>Add to basket</Text></Pressable>:null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}


function fulfillmentLabel(value:string){
 return value==="pickup"?"Customer pickup":"Delivery";
}

function isCartLine(value:unknown):value is CartLine{
 const line=record(value);
 return typeof line.itemId==="string" && (typeof line.variantId==="string"||line.variantId===null) &&
  typeof line.name==="string" && (typeof line.variantName==="string"||line.variantName===null) &&
  typeof line.quantity==="number" && Number.isInteger(line.quantity) && line.quantity>0 && line.quantity<=99 &&
  typeof line.unitAmount==="number" && Number.isFinite(line.unitAmount) && line.unitAmount>0 &&
  typeof line.currencyCode==="string";
}

function StoreProductMedia({assetId,label,isVideo}:{assetId:string;label:string;isVideo:boolean}){
 const {palette}=useAppTheme();
 const {session,api,status}=useSession();
 const media=useQuery({
  queryKey:["logistics-store-media-detail",assetId,session?.user.id??"anonymous"],
  enabled:Boolean(isVideo&&status==="authenticated"),
  staleTime:10*60*1000,
  queryFn:()=>api.post("/runtime/media/read-sessions",{assetId,idempotencyKey:`logistics-store-video:${assetId}`},MediaReadSchema),
 });
 if(!isVideo) return <View style={{width:220}}><ProductImage assetId={assetId} label={label}/></View>;
 return <Pressable disabled={!media.data?.signedUrl} onPress={()=>{if(media.data?.signedUrl)void Linking.openURL(media.data.signedUrl);}} style={{width:220,height:150,borderRadius:radii.md,borderWidth:1,borderColor:palette.border,backgroundColor:palette.brandSoft,alignItems:"center",justifyContent:"center",padding:12}}>
  <ShoppingBag color={palette.brand} size={28}/>
  <Text style={{color:palette.ink,fontSize:12,fontWeight:"900",marginTop:8}}>Watch product video</Text>
  <Text style={{color:palette.muted,fontSize:10,marginTop:3}}>{media.isPending?"Loading video…":media.error?"Video unavailable":"Tap to play"}</Text>
 </Pressable>;
}

function ProductImage({assetId,label}:{assetId:string|null;label:string}){
 const {palette}=useAppTheme();
 const {session,api,status}=useSession();
 const media=useQuery({
  queryKey:["logistics-store-media",assetId,session?.user.id??"anonymous"],
  enabled:Boolean(assetId&&status==="authenticated"),
  staleTime:12*60*1000,
  queryFn:()=>api.post("/runtime/media/read-sessions",{assetId,idempotencyKey:`logistics-store-media:${assetId}`},MediaReadSchema),
 });
 return <View style={[styles.productImage,{backgroundColor:palette.brandSoft}]}>
  {media.data?.signedUrl?<Image source={{uri:media.data.signedUrl}} resizeMode="cover" style={{width:"100%",height:"100%"}} accessibilityLabel={label}/>:<ShoppingBag color={palette.brand} size={24}/>}
 </View>;
}

function Filter({label,active,onPress}:{label:string;active:boolean;onPress:()=>void}){
 const {palette}=useAppTheme();
 return <Pressable onPress={onPress} style={[styles.filter,{backgroundColor:active?palette.brandSoft:palette.surface,borderColor:active?palette.brand:palette.border}]}><Text style={{color:active?palette.brand:palette.ink,fontSize:10,fontWeight:"800"}}>{label}</Text></Pressable>;
}
const styles=StyleSheet.create({
 back:{flexDirection:"row",alignItems:"center",gap:7,marginBottom:5},backText:{fontSize:11,fontWeight:"800"},
  hero:{minHeight:104,borderWidth:StyleSheet.hairlineWidth,borderRadius:radii.lg,padding:12,flexDirection:"row",alignItems:"center",gap:10},
  heroCopy:{flex:1,gap:4},heroEyebrow:{fontSize:9,fontWeight:"900",letterSpacing:1},heroTitle:{fontSize:17,lineHeight:20,fontWeight:"900"},heroBody:{fontSize:9,lineHeight:13},
  heroIcon:{width:50,height:50,borderRadius:16,alignItems:"center",justifyContent:"center"},
  sectionHead:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginTop:6},sectionTitle:{fontSize:15,fontWeight:"900"},sectionSubtitle:{fontSize:10,lineHeight:15,fontWeight:"600"},
 toolbar:{borderWidth:StyleSheet.hairlineWidth,borderRadius:radii.lg,padding:8,flexDirection:"row",alignItems:"center",gap:8},
 search:{flex:1,minWidth:0,height:38,flexDirection:"row",alignItems:"center",gap:7,paddingHorizontal:8},searchInput:{flex:1,minWidth:0,fontSize:12,paddingVertical:0},
 walletPill:{flexDirection:"row",alignItems:"center",gap:5,borderRadius:radii.pill,backgroundColor:"rgba(220,45,65,.09)",paddingHorizontal:9,paddingVertical:8},
 productMedia:{position:"relative"},productImage:{height:128,width:"100%",borderRadius:radii.md,overflow:"hidden",alignItems:"center",justifyContent:"center",backgroundColor:"rgba(220,45,65,.07)"},discountBadge:{position:"absolute",left:7,top:7,paddingHorizontal:7,paddingVertical:5,borderRadius:7},discountText:{color:"#fff",fontSize:8,fontWeight:"900"},productCategory:{fontSize:9,fontWeight:"700"},
 filters:{gap:7,paddingVertical:9},filter:{paddingHorizontal:12,paddingVertical:8,borderWidth:StyleSheet.hairlineWidth,borderRadius:radii.pill},
 grid:{flexDirection:"row",flexWrap:"wrap",gap:10},product:{minWidth:142,flexGrow:1,borderWidth:StyleSheet.hairlineWidth,borderRadius:radii.lg,padding:11,gap:6},
 productIcon:{width:44,height:44,borderRadius:13,alignItems:"center",justifyContent:"center"},productName:{...typography.bodyStrong,fontSize:13,lineHeight:17,minHeight:34},
 productDescription:{...typography.caption,fontSize:10,lineHeight:14},price:{fontSize:13,fontWeight:"900"},priceRow:{flexDirection:"row",alignItems:"center",flexWrap:"wrap",gap:6},comparePrice:{fontSize:10,textDecorationLine:"line-through",fontWeight:"600"},
 add:{height:34,borderRadius:radii.md,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:5},addText:{color:"#fff",fontSize:10,fontWeight:"900"},
 cartPanel:{borderWidth:StyleSheet.hairlineWidth,borderRadius:radii.lg,padding:12,gap:9},cartHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},
 cartTitleRow:{flexDirection:"row",alignItems:"center",gap:7},cartTitle:{fontSize:12,fontWeight:"900"},cartTotal:{fontSize:14,fontWeight:"900"},
 cartLine:{flexDirection:"row",alignItems:"center",gap:8},cartName:{fontSize:10,fontWeight:"700"},cartAmount:{fontSize:10,fontWeight:"800"},
 quantity:{flexDirection:"row",alignItems:"center",gap:9},options:{flexDirection:"row",gap:8},locationChoices:{gap:6},formLabel:{fontSize:11,fontWeight:"800"},
 location:{borderWidth:1,borderRadius:radii.md,padding:9},locationText:{fontSize:10,fontWeight:"700"},
 note:{minHeight:39,borderWidth:1,borderRadius:radii.md,paddingHorizontal:10,fontSize:11},error:{fontSize:10,fontWeight:"800"},
 checkout:{minHeight:43,borderRadius:radii.md,alignItems:"center",justifyContent:"center"},checkoutText:{color:"#fff",fontSize:12,fontWeight:"900"},
 detailBackdrop:{flex:1,justifyContent:"flex-end",backgroundColor:"rgba(0,0,0,.5)"},
 detailPanel:{maxHeight:"88%",borderTopLeftRadius:24,borderTopRightRadius:24,padding:16,gap:12},
 detailHandle:{width:42,height:4,borderRadius:3,backgroundColor:"#A5A5AB",alignSelf:"center"},
 detailHeader:{flexDirection:"row",alignItems:"center",gap:10},
 detailTitle:{fontSize:18,fontWeight:"900"},
 detailClose:{width:36,height:36,borderRadius:12,alignItems:"center",justifyContent:"center"},
 detailDescription:{fontSize:12,lineHeight:18},
});
