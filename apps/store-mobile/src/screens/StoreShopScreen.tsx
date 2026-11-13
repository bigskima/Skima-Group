import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { ArrowLeft, Minus, Plus, Search, ShoppingBag, ShoppingCart, X } from "lucide-react-native";
import { z } from "zod";
import { useSession } from "../session/SessionProvider";
import { useStorefrontData, useStoreRecords, asNumber, asString, money, makeIdempotencyKey } from "../api/store";
import { useAppTheme } from "../theme/ThemeProvider";
import { Page, Card, SectionTitle, ActionButton, State, Notice } from "./StoreUI";
import { AppButton } from "../ui/AppButton";
import { GuideTarget } from "../onboarding/StoreGuideProvider";
import { StorePromotionBanner } from "../ui/StorePromotionBanner";
import { StorefrontBasketLine, StorefrontCategoryChip, StorefrontDetailSheet, StorefrontHero, StorefrontProductCard } from "@skima/mobile-experience/StorefrontParity";

type Row=Record<string,unknown>;
type CartLine={itemId:string;variantId:string|null;name:string;variantName:string|null;quantity:number;unitAmount:number;currencyCode:string;stock:number|null};
type Product={item:Row;id:string;variantId:string|null;name:string;variantName:string|null;description:string|null;amount:number;compareAtAmount:number|null;currency:string;stock:number|null;imageAssetId:string|null};
const OrderSchema=z.union([z.string(),z.record(z.string(),z.unknown())]);
const AddressAutocompleteSchema=z.object({
 predictions:z.array(z.record(z.string(),z.unknown())),
 provider:z.string().optional(),
 providerAttribution:z.string().optional(),
}).passthrough();
const AddressGeocodeSchema=z.object({
 addressComponents:z.record(z.string(),z.unknown()).nullable().optional(),
 formattedAddress:z.string().nullable().optional(),
 location:z.object({latitude:z.number(),longitude:z.number()}),
 placeId:z.string().nullable().optional(),
 provider:z.string(),
}).passthrough();
const MediaSchema=z.object({assetId:z.string(),contentType:z.string().nullable(),expiresInSeconds:z.number().positive(),signedUrl:z.string().url()});
const record=(v:unknown):Row=>v&&typeof v==="object"&&!Array.isArray(v)?v as Row:{};
const metadata=(v:Row)=>record(v.metadata);
function effective(row:Row,now:number){const from=typeof row.effective_from==="string"?Date.parse(row.effective_from):null;const until=typeof row.effective_until==="string"?Date.parse(row.effective_until):null;return(from===null||!Number.isFinite(from)||from<=now)&&(until===null||!Number.isFinite(until)||until>now);}
function isCartLine(v:unknown):v is CartLine{const r=record(v);return typeof r.itemId==="string"&&typeof r.name==="string"&&typeof r.quantity==="number"&&r.quantity>0&&typeof r.unitAmount==="number"&&typeof r.currencyCode==="string"&&(r.variantId===null||typeof r.variantId==="string");}

export function StoreShopScreen(){
 const session=useSession();const {palette}=useAppTheme();const {width}=useWindowDimensions();const cache=useQueryClient();
 const store=useStorefrontData();
 const wallets=useStoreRecords(["store","wallets"],"/runtime/wallets",true,30000);
 const balances=useStoreRecords(["store","balances"],"/runtime/wallet-balances",true,20000);
 const locations=useStoreRecords(["store","locations"],"/lpg/locations",true,60000);
 const orders=useStoreRecords(["store","orders"],"/runtime/storefront/orders",true,15000);
 const userId=session.session?.user.id??"";
 const moduleId=asString(store.storeModule,"id");
 const cartKey="skima:store:cart:v1:"+userId+":"+(moduleId??"unconfigured");
 const [cart,setCart]=useState<CartLine[]>([]);const [cartReady,setCartReady]=useState(false);const [loadedKey,setLoadedKey]=useState("");
 const [search,setSearch]=useState("");const [category,setCategory]=useState("all");const [selectedProduct,setSelectedProduct]=useState<Product|null>(null);const [fulfillment,setFulfillment]=useState<"delivery"|"pickup">("delivery");const [checkoutStep,setCheckoutStep]=useState<"browse"|"basket"|"fulfillment"|"review">("browse");
 const [locationId,setLocationId]=useState("");const [note,setNote]=useState("");const [notice,setNotice]=useState("");const [checkoutKey,setCheckoutKey]=useState(()=>makeIdempotencyKey("store-checkout"));
 const [addressEditorOpen,setAddressEditorOpen]=useState(false);const [addressSearch,setAddressSearch]=useState("");const [debouncedAddressSearch,setDebouncedAddressSearch]=useState("");const [addressLabel,setAddressLabel]=useState("Home");const [addressInstructions,setAddressInstructions]=useState("");const [addressNotice,setAddressNotice]=useState("");const [addressResolving,setAddressResolving]=useState(false);const [addressSaving,setAddressSaving]=useState(false);const [makeAddressPreferred,setMakeAddressPreferred]=useState(true);
 const addressSaveKey=useRef<string|null>(null);
 useEffect(()=>{const timer=setTimeout(()=>setDebouncedAddressSearch(addressSearch.trim()),350);return()=>clearTimeout(timer);},[addressSearch]);
 const addressAutocomplete=useQuery({
  queryKey:["skima-store","address-autocomplete",debouncedAddressSearch.toLowerCase()],
  enabled:addressEditorOpen&&debouncedAddressSearch.length>=3,
  retry:false,
  queryFn:()=>session.api.post("/lpg/maps/autocomplete",{input:debouncedAddressSearch+", Nigeria"},AddressAutocompleteSchema),
  staleTime:60_000,
 });

 useEffect(()=>{let active=true;setCartReady(false);void AsyncStorage.getItem(cartKey).then(saved=>{if(!active)return;try{const parsed:unknown=saved?JSON.parse(saved):[];setCart(Array.isArray(parsed)?parsed.filter(isCartLine):[]);}catch{setCart([]);}}).catch(()=>{if(active)setCart([]);}).finally(()=>{if(active){setLoadedKey(cartKey);setCartReady(true);}});return()=>{active=false;};},[cartKey]);
 useEffect(()=>{if(cartReady&&loadedKey===cartKey)void AsyncStorage.setItem(cartKey,JSON.stringify(cart)).catch(()=>undefined);},[cart,cartReady,loadedKey,cartKey]);
 const settings=store.activeSettings;const currency=asString(settings,"currency_code")??"NGN";
 const customerWallet=(wallets.data??[]).find(w=>asString(w,"wallet_type")==="customer"&&asString(w,"owner_entity_type")==="user"&&asString(w,"owner_entity_id")===userId&&asString(w,"currency_code")===currency&&asString(w,"status")==="active")??null;
 const walletId=asString(customerWallet,"id");const balance=asNumber((balances.data??[]).find(b=>asString(b,"wallet_id")===walletId),"balance")??0;
 const configuredMethods:("delivery"|"pickup")[]=Array.isArray(settings?.fulfillment_methods)?settings.fulfillment_methods.filter((v):v is "delivery"|"pickup"=>v==="delivery"||v==="pickup"):[];const allowedMethods:("delivery"|"pickup")[]=configuredMethods.length?configuredMethods:(settings?.fulfillment_method==="pickup"?["pickup"]:["delivery","pickup"]);
 useEffect(()=>{if(!allowedMethods.includes(fulfillment))setFulfillment(allowedMethods[0]??"delivery");},[allowedMethods.join("|"),fulfillment]);
 const addresses=(locations.data??[]).filter(l=>![ "inactive","disabled","deleted" ].includes((asString(l,"status")??"").toLowerCase()));
 useEffect(()=>{if(!locationId&&addresses.length){const preferred=addresses.find(l=>l.is_default===true)??addresses[0];setLocationId(asString(preferred,"id")??"");}},[addresses,locationId]);
 const products=useMemo<Product[]>(()=>{
  if(!settings||!moduleId)return [];
  const now=Date.now();const out:Product[]=[];
  for(const item of store.items.data??[]){
   const id=asString(item,"id");if(!id||asString(item,"module_id")!==moduleId||asString(item,"organization_id")!==asString(settings,"organization_id")||asString(item,"status")!=="active"||metadata(item).sales_channel!=="skima_store")continue;
   const methods=Array.isArray(item.fulfillment_methods)?item.fulfillment_methods.filter((v):v is string=>typeof v==="string"):[];
   if(methods.length&&!allowedMethods.some(m=>methods.includes(m)))continue;
   const variants=(store.variants.data??[]).filter(v=>asString(v,"item_id")===id&&asString(v,"status")==="active");
   const prices=(store.prices.data??[]).filter(p=>asString(p,"item_id")===id&&asString(p,"currency_code")===currency&&asString(p,"status")==="active"&&effective(p,now));
   const stockRules=(store.availability.data??[]).filter(s=>asString(s,"item_id")===id&&asString(s,"status")==="active"&&effective(s,now));
   for(const variant of variants.length?variants:[null]){
    const variantId=variant?asString(variant,"id"):null;
    const price=prices.find(p=>(asString(p,"variant_id")??null)===variantId)??prices.find(p=>!asString(p,"variant_id"));
    const stock=stockRules.find(s=>(asString(s,"variant_id")??null)===variantId)??stockRules.find(s=>!asString(s,"variant_id"));
    if(!price||!stock||asString(stock,"availability_status")!=="available")continue;
    const amount=asNumber(price,"amount","unit_amount","price_amount");if(amount===null||amount<=0)continue;
    const qty=asNumber(stock,"stock_quantity");const reserved=asNumber(stock,"reserved_quantity")??0;const remaining=qty===null?null:Math.max(0,qty-reserved);if(remaining!==null&&remaining<=0)continue;
    const media=(store.media.data??[]).filter(m=>asString(m,"item_id")===id&&asString(m,"status")==="active"&&metadata(m).mediaType!=="video").sort((a,b)=>(asNumber(a,"display_order")??0)-(asNumber(b,"display_order")??0));
    out.push({item,id,variantId,name:asString(item,"display_name","name","title")??"Store item",variantName:variant?asString(variant,"display_name","name","label"):null,description:asString(item,"description"),amount,compareAtAmount:asNumber(price,"compare_at_amount"),currency,stock:remaining,imageAssetId:asString(media[0],"media_asset_id","mediaAssetId")});
   }
  }
  return out;
 },[settings,moduleId,store.items.data,store.variants.data,store.prices.data,store.availability.data,store.media.data,currency,allowedMethods.join("|")]);
 const categories=(store.categories.data??[]).filter(c=>asString(c,"status")==="active"&&asString(c,"module_id")===moduleId);
 const filtered=products.filter(p=>(category==="all"||asString(p.item,"category_id")===category)&&[p.name,p.variantName??"",p.description??""].join(" ").toLowerCase().includes(search.toLowerCase().trim()));
 const subtotal=cart.reduce((s,l)=>s+l.unitAmount*l.quantity,0);const cartCurrency=cart[0]?.currencyCode??currency;
 const baseFee=asNumber(settings,"delivery_base_fee_amount")??0;const freeAt=asNumber(settings,"free_delivery_minimum_amount");
 const deliveryFee=fulfillment==="pickup"||(freeAt!==null&&subtotal>=freeAt)?0:baseFee;
 const minimum=asNumber(settings,"minimum_order_amount")??0;const total=subtotal+deliveryFee;
 const allowedCurrency=cart.every(l=>l.currencyCode===currency)&&cartCurrency===currency;
 const canCheckout=Boolean(cart.length&&cartReady&&walletId&&allowedCurrency&&balance>=total&&subtotal>=minimum&&total>0&&(fulfillment==="pickup"||locationId));
 const itemCount=cart.reduce((sum,line)=>sum+line.quantity,0);
 const canReview=Boolean(cart.length&&allowedCurrency&&(fulfillment==="pickup"||locationId));
 const selectedAddress=addresses.find(address=>asString(address,"id")===locationId)??null;
 const saveStoreAddress=async(addressText:string)=>{
  const query=addressText.trim();
  if(query.length<5){setAddressNotice("Enter a full street address, landmark, town and state.");return;}
  if(addressSaving||addressResolving)return;
  setAddressResolving(true);setAddressNotice("");
  try{
   const resolved=await session.api.post("/lpg/maps/geocode",{address:query+", Nigeria"},AddressGeocodeSchema);
   const formattedAddress=resolved.formattedAddress?.trim()||query;
   if(!Number.isFinite(resolved.location.latitude)||!Number.isFinite(resolved.location.longitude))throw new Error("The map service did not return a precise position. Add a street, area or landmark and try again.");
   setAddressResolving(false);setAddressSaving(true);
   const saveIdempotencyKey=addressSaveKey.current??makeIdempotencyKey("store-location");
   addressSaveKey.current=saveIdempotencyKey;
   const saved=await session.api.post("/lpg/locations",{
    label:addressLabel.trim()||"Saved address",
    formattedAddress,
    latitude:resolved.location.latitude,
    longitude:resolved.location.longitude,
    address:resolved.addressComponents??{},
    deliveryInstructions:addressInstructions.trim()||null,
    providerPlaceId:resolved.placeId??null,
    providerSource:"maps_adapter",
    captureSource:"MANUAL_ADDRESS",
    capturedAt:new Date().toISOString(),
    source:"skima.store.mobile",
    metadata:{sourceApp:"store",addressEntryMode:"manual_search"},
    idempotencyKey:saveIdempotencyKey,
   },OrderSchema);
   const refreshedLocations=await locations.refetch();
   const savedRecord=record(saved);
   let savedId=asString(savedRecord,"id","locationId","location_id")??(typeof saved==="string"?saved:"");
   if(!savedId){
    const refreshed=refreshedLocations.data??[];
    const match=refreshed.find(item=>asString(item,"formatted_address")===formattedAddress);
    savedId=asString(match,"id")??"";
   }
   if(savedId){
    setLocationId(savedId);
    if(makeAddressPreferred){
     const {error}=await session.supabase.rpc("set_lpg_customer_location_default",{target_location_id:savedId});
     if(error)throw new Error("Address saved, but the preferred-address setting could not be updated: "+error.message);
     await locations.refetch();
    }
   }
   setCheckoutKey(makeIdempotencyKey("store-checkout"));
   setAddressNotice("Address saved and selected for this Store delivery.");
   addressSaveKey.current=null;
   setAddressEditorOpen(false);setAddressSearch("");setDebouncedAddressSearch("");setAddressInstructions("");
  }catch(error){
   setAddressNotice(error instanceof Error?error.message:"We couldn't resolve or save that address. Try a more specific street or landmark.");
  }finally{
   setAddressResolving(false);setAddressSaving(false);
  }
 };
 const checkout=useMutation({
  mutationFn:async()=>{
   if(!canCheckout)throw new Error("Choose delivery or pickup and make sure your SKIMA Wallet covers the total.");
   return session.api.post("/runtime/storefront/checkout",{lineItems:cart.map(l=>({itemId:l.itemId,variantId:l.variantId,quantity:l.quantity})),customerWalletId:walletId,fulfillmentMethod:fulfillment,deliveryLocationId:fulfillment==="delivery"?locationId:null,customerNote:note.trim()||null,idempotencyKey:checkoutKey},OrderSchema);
  },
  onSuccess:async(result)=>{const obj=record(result);const orderId=asString(obj,"orderId")??(typeof result==="string"?result:"");setCart([]);setNote("");setCheckoutStep("browse");setCheckoutKey(makeIdempotencyKey("store-checkout"));setNotice(orderId?"Your order "+orderId.slice(0,8).toUpperCase()+" was received. Payment is held securely until the order is completed.":"Your Store order was submitted. Payment is held securely until the order is completed.");await Promise.all([wallets.refetch(),balances.refetch(),orders.refetch()]);await cache.invalidateQueries({queryKey:["skima-store"]});},
  onError:(error)=>Alert.alert("Checkout unavailable",error instanceof Error?error.message:"Please review your basket and try again.")
 });
 const refresh=()=>void Promise.all([store.items.refetch(),store.prices.refetch(),store.availability.refetch(),orders.refetch(),wallets.refetch(),balances.refetch()]);
 const busy=store.modules.isPending||store.settings.isPending;
 if(busy)return <Page><State title="Opening SKIMA Store" body="Getting the shop ready…"/></Page>;
 if(!store.storeModule||!settings)return <Page><State title="Store is not currently available" body="Store isn’t available right now. Please try again later."/></Page>;
 return <Page guidePage="shop" refreshControl={<RefreshControl refreshing={store.items.isRefetching||store.prices.isRefetching} onRefresh={refresh} tintColor={palette.brand}/>}>
  {checkoutStep==="browse"?<>
   <GuideTarget page="shop" targetKey="store.shop.hero"><StorefrontHero palette={palette} walletValue={money(balance,currency)} basketCount={itemCount} basketSubtotal={money(subtotal,currency)} onBasketPress={()=>setCheckoutStep("basket")} disabled={!cart.length}/></GuideTarget>
   <StorePromotionBanner />
   <GuideTarget page="shop" targetKey="store.shop.categories"><View style={{gap:10}}>
    <View style={[styles.search,{borderColor:palette.border,backgroundColor:palette.surface}]}><Search size={16} color={palette.muted}/><TextInput value={search} onChangeText={setSearch} placeholder="Search products" placeholderTextColor={palette.muted} style={{flex:1,color:palette.ink,fontSize:12}}/>{search?<Pressable onPress={()=>setSearch("")}><X size={16} color={palette.muted}/></Pressable>:null}</View>
    <SectionTitle title="Explore categories" caption="Browse products from participating sellers."/>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}><StorefrontCategoryChip palette={palette} label="All" active={category==="all"} onPress={()=>setCategory("all")}/>{categories.map(c=><StorefrontCategoryChip key={asString(c,"id")??""} palette={palette} label={asString(c,"display_name","name")??"Category"} active={category===asString(c,"id")} onPress={()=>setCategory(asString(c,"id")??"all")}/>)}</ScrollView>
   </View></GuideTarget>
   <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:10}}>
    <SectionTitle title={search.trim()?"Search results":"Picked for everyday"} caption={filtered.length+" available options"}/>
    {cart.length?<GuideTarget page="shop" targetKey="store.shop.basket"><Pressable accessibilityRole="button" accessibilityLabel={`Open basket with ${itemCount} items`} onPress={()=>setCheckoutStep("basket")} style={{flexDirection:"row",alignItems:"center",gap:6,paddingHorizontal:11,paddingVertical:9,borderRadius:13,backgroundColor:palette.brandSoft}}>
     <ShoppingCart color={palette.brand} size={15}/>
     <Text style={{fontSize:10,fontWeight:"900",color:palette.brand}}>Basket · {itemCount} · {money(subtotal,currency)}</Text>
    </Pressable></GuideTarget>:null}
   </View>
   {store.items.isPending||store.prices.isPending||store.availability.isPending?<State title="Finding products" body="Checking live prices and stock for you."/>:store.items.error||store.prices.error||store.availability.error?<State title="Products unavailable" body="Refresh the shop and try again." retry={refresh}/>:filtered.length?<View style={styles.grid}>{filtered.map(p=><StorefrontProductCard key={p.id+":"+(p.variantId??"base")} palette={palette} width={width>=1100?"23.8%":width>=700?"31.8%":"48.5%"} media={<StoreImage assetId={p.imageAssetId} label={p.name}/>} categoryLabel={asString(p.item,"category_name","category")??"SKIMA Store"} name={p.name} variantName={p.variantName} priceLabel={money(p.amount,p.currency)} compareAtLabel={p.compareAtAmount&&p.compareAtAmount>p.amount?money(p.compareAtAmount,p.currency):null} stockLabel={p.stock===null?"Available":p.stock+" in stock"} onDetails={()=>setSelectedProduct(p)} addDisabled={checkout.isPending} onAdd={()=>{setCheckoutKey(makeIdempotencyKey("store-checkout"));setCart(cur=>{const found=cur.find(x=>x.itemId===p.id&&x.variantId===p.variantId);if(found)return cur.map(x=>x===found?{...x,quantity:p.stock===null?x.quantity+1:Math.min(p.stock,x.quantity+1)}:x);return [...cur,{itemId:p.id,variantId:p.variantId,name:p.name,variantName:p.variantName,quantity:1,unitAmount:p.amount,currencyCode:p.currency,stock:p.stock}];});}}/>)}</View>:<State title="No products found" body="Try another category or a different search."/>}
   
   {notice?<Notice text={notice} tone="success"/>:null}
  </>:<>
   <View style={{gap:10}}>
    <Pressable onPress={()=>setCheckoutStep(checkoutStep==="review"?"fulfillment":checkoutStep==="fulfillment"?"basket":"browse")} style={{alignSelf:"flex-start",flexDirection:"row",alignItems:"center",gap:7,paddingVertical:5}}><Text style={{fontSize:11,fontWeight:"900",color:palette.brand}}>‹ Back {checkoutStep==="basket"?"to shop":checkoutStep==="fulfillment"?"to basket":"to delivery"}</Text></Pressable>
    <View style={{gap:4}}><Text style={{fontSize:22,color:palette.ink,fontWeight:"900",letterSpacing:-.4}}>{checkoutStep==="basket"?"Your basket":checkoutStep==="fulfillment"?"Delivery details":"Review your order"}</Text><Text style={{fontSize:11,color:palette.muted,lineHeight:16}}>{checkoutStep==="basket"?"Check quantities and make your selection." : checkoutStep==="fulfillment"?"Choose how you would like to receive your items." : "Everything looks right? Confirm your order securely."}</Text></View>
    <View style={{flexDirection:"row",gap:6}}>{(["basket","fulfillment","review"] as const).map((step,index)=><View key={step} style={{flex:1,gap:5}}><View style={{height:4,borderRadius:8,backgroundColor:(["basket","fulfillment","review"].indexOf(checkoutStep)>=index)?palette.brand:palette.border}}/><Text style={{fontSize:9,fontWeight:"800",color:checkoutStep===step?palette.brand:palette.muted}}>{index+1}. {step==="basket"?"Basket":step==="fulfillment"?"Delivery":"Review"}</Text></View>)}</View>
   </View>
   {checkoutStep==="basket"?<Card style={{gap:12}}>
    {cart.length?cart.map(line=><StorefrontBasketLine key={line.itemId+":"+(line.variantId??"base")} palette={palette} name={line.name} variantName={line.variantName} quantity={line.quantity} amountLabel={money(line.unitAmount*line.quantity,line.currencyCode)} increaseDisabled={checkout.isPending||line.stock!==null&&line.quantity>=line.stock} onDecrease={()=>{setCheckoutKey(makeIdempotencyKey("store-checkout"));setCart(cur=>cur.map(x=>x.itemId===line.itemId&&x.variantId===line.variantId?{...x,quantity:Math.max(0,x.quantity-1)}:x).filter(x=>x.quantity>0));}} onIncrease={()=>{setCheckoutKey(makeIdempotencyKey("store-checkout"));setCart(cur=>cur.map(x=>x.itemId===line.itemId&&x.variantId===line.variantId?{...x,quantity:x.stock===null?x.quantity+1:Math.min(x.stock,x.quantity+1)}:x));}}/>):<State title="Your basket is empty" body="Browse the shop and add something you like." retry={()=>setCheckoutStep("browse")}/>}
    <View style={{gap:8,backgroundColor:palette.surfaceSubtle,padding:13,borderRadius:14}}><FinanceLine label={"Items · "+itemCount} value={money(subtotal,currency)}/><FinanceLine label="Delivery or pickup" value="Choose in the next step"/><FinanceLine label="Items total" value={money(subtotal,currency)} strong/></View>
    <AppButton label="Continue to delivery" fullWidth disabled={!cart.length||checkout.isPending} onPress={()=>setCheckoutStep("fulfillment")}/>
   </Card>:null}
   {checkoutStep==="fulfillment"?<Card style={{gap:13}}>
    <View style={{gap:4}}><Text style={{fontSize:12,color:palette.ink,fontWeight:"900"}}>How should we get it to you?</Text><Text style={{fontSize:10,color:palette.muted}}>Select an available fulfilment method.</Text></View>
    <View style={{flexDirection:"row",gap:8}}>{allowedMethods.includes("delivery")?<View style={{flex:1}}><ActionButton label="Delivery" variant={fulfillment==="delivery"?"primary":"secondary"} disabled={checkout.isPending} onPress={()=>{setCheckoutKey(makeIdempotencyKey("store-checkout"));setFulfillment("delivery");}}/></View>:null}{allowedMethods.includes("pickup")?<View style={{flex:1}}><ActionButton label="Pickup" variant={fulfillment==="pickup"?"primary":"secondary"} disabled={checkout.isPending} onPress={()=>{setCheckoutKey(makeIdempotencyKey("store-checkout"));setFulfillment("pickup");}}/></View>:null}</View>
    {fulfillment==="delivery"?<View style={{gap:8}}>
      <Text style={{color:palette.ink,fontSize:11,fontWeight:"900"}}>Choose delivery address</Text>
      {addresses.slice(0,6).map(address=><Pressable key={asString(address,"id")??""} disabled={checkout.isPending} onPress={()=>{setCheckoutKey(makeIdempotencyKey("store-checkout"));setLocationId(asString(address,"id")??"");}} style={[styles.address,{backgroundColor:locationId===asString(address,"id")?palette.brandSoft:palette.surfaceSubtle,borderColor:locationId===asString(address,"id")?palette.brand:palette.border}]}><Text style={{color:palette.ink,fontSize:10,fontWeight:"700"}}>{asString(address,"formatted_address","display_name","address")??"Saved address"}</Text><Text style={{color:palette.muted,fontSize:9}}>{locationId===asString(address,"id")?"Selected":address.is_default===true?"Preferred · Tap to select":"Tap to select"}</Text></Pressable>)}
      <Pressable accessibilityRole="button" disabled={checkout.isPending} onPress={()=>{setAddressEditorOpen(open=>!open);setAddressNotice("");}} style={{alignSelf:"flex-start",paddingVertical:8}}>
       <Text style={{color:palette.brand,fontSize:11,fontWeight:"900"}}>{addressEditorOpen?"Close address search":"+ Add another delivery address"}</Text>
      </Pressable>
      {addressEditorOpen?<View style={{gap:9,padding:12,borderWidth:1,borderColor:palette.border,borderRadius:14,backgroundColor:palette.surface}}>
       <Text style={{color:palette.ink,fontSize:12,fontWeight:"900"}}>Find another delivery address</Text>
       <Text style={{color:palette.muted,fontSize:10,lineHeight:15}}>Enter the recipient’s street or house address. It does not have to be your current location.</Text>
       <TextInput value={addressLabel} onChangeText={setAddressLabel} placeholder="Save as Home, Office or Recipient" placeholderTextColor={palette.muted} style={[styles.note,{color:palette.ink,borderColor:palette.border,minHeight:42}]}/>
       <TextInput value={addressSearch} onChangeText={setAddressSearch} placeholder="Street, house number, landmark, town and state" placeholderTextColor={palette.muted} multiline style={[styles.note,{color:palette.ink,borderColor:palette.border,minHeight:72,textAlignVertical:"top"}]}/>
       {addressAutocomplete.isFetching?<Text style={{color:palette.muted,fontSize:10}}>Searching street addresses…</Text>:null}
       {(addressAutocomplete.data?.predictions??[]).slice(0,5).map((prediction,index)=>{
        const description=asString(prediction,"description","formattedAddress","formatted_address");
        if(!description)return null;
        return <Pressable key={description+":"+index} disabled={addressResolving||addressSaving} onPress={()=>{setAddressSearch(description);void saveStoreAddress(description);}} style={{paddingVertical:9,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:palette.border}}>
         <Text style={{color:palette.ink,fontSize:10,fontWeight:"700"}}>{description}</Text>
        </Pressable>;
       })}
       <TextInput value={addressInstructions} onChangeText={setAddressInstructions} placeholder="Gate, floor or delivery instructions (optional)" placeholderTextColor={palette.muted} multiline style={[styles.note,{color:palette.ink,borderColor:palette.border,minHeight:52,textAlignVertical:"top"}]}/>
       <View style={{flexDirection:"row",alignItems:"center",gap:8}}>
        <Pressable accessibilityRole="checkbox" accessibilityState={{checked:makeAddressPreferred}} onPress={()=>setMakeAddressPreferred(value=>!value)} style={{width:20,height:20,borderWidth:1,borderRadius:5,borderColor:makeAddressPreferred?palette.brand:palette.border,backgroundColor:makeAddressPreferred?palette.brand:"transparent",alignItems:"center",justifyContent:"center"}}>
         {makeAddressPreferred?<Text style={{color:"#fff",fontSize:12,fontWeight:"900"}}>✓</Text>:null}
        </Pressable>
        <Text style={{color:palette.muted,fontSize:10,flex:1}} onPress={()=>setMakeAddressPreferred(value=>!value)}>Set as my preferred saved address</Text>
       </View>
       <ActionButton label={addressResolving?"Finding address…":addressSaving?"Saving address…":"Find and save typed address"} disabled={addressResolving||addressSaving||addressSearch.trim().length<5||addressLabel.trim().length<2} loading={addressResolving||addressSaving} onPress={()=>void saveStoreAddress(addressSearch)}/>
       {addressNotice?<Notice text={addressNotice} tone={addressNotice.startsWith("Address saved")?"success":"warning"}/>:null}
       {addressAutocomplete.error?<Text style={{color:palette.warning,fontSize:10}}>Address suggestions are unavailable. You can still submit the full address to the geocoder above.</Text>:null}
      </View>:null}
      {!addresses.length?<Notice text="No saved delivery address is available. Add one here or choose pickup." tone="warning"/>:null}
     </View>:<Notice text="Pickup selected. Your order will use the Store pickup location."/>}
    <View style={{gap:6}}><Text style={{color:palette.ink,fontSize:11,fontWeight:"900"}}>Order note <Text style={{color:palette.muted,fontWeight:"500"}}>(optional)</Text></Text><TextInput value={note} editable={!checkout.isPending} onChangeText={value=>{setCheckoutKey(makeIdempotencyKey("store-checkout"));setNote(value);}} placeholder="Add delivery instructions or a note" placeholderTextColor={palette.muted} multiline style={[styles.note,{borderColor:palette.border,color:palette.ink,minHeight:76,textAlignVertical:"top"}]}/></View>
    {fulfillment==="delivery"&&selectedAddress?<View style={{gap:3,padding:11,borderRadius:13,backgroundColor:palette.surfaceSubtle}}><Text style={{fontSize:9,color:palette.muted,fontWeight:"800"}}>DELIVERY TO</Text><Text style={{fontSize:11,color:palette.ink,fontWeight:"800"}}>{asString(selectedAddress,"formatted_address","display_name","address")??"Saved address"}</Text></View>:null}
    <AppButton label="Review order" fullWidth disabled={!canReview||checkout.isPending} onPress={()=>setCheckoutStep("review")}/>
   </Card>:null}
   {checkoutStep==="review"?<Card style={{gap:12}}>
    <View style={{gap:7}}><Text style={{fontSize:12,color:palette.ink,fontWeight:"900"}}>Items in your order</Text>{cart.map(line=><View key={line.itemId+":"+(line.variantId??"base")} style={{flexDirection:"row",justifyContent:"space-between",gap:8}}><Text style={{flex:1,color:palette.muted,fontSize:10}}>{line.quantity} × {line.name}</Text><Text style={{color:palette.ink,fontSize:10,fontWeight:"800"}}>{money(line.unitAmount*line.quantity,line.currencyCode)}</Text></View>)}</View>
    <View style={{height:1,backgroundColor:palette.border}}/>
    <View style={{gap:6}}><Text style={{fontSize:12,color:palette.ink,fontWeight:"900"}}>Fulfilment</Text><FinanceLine label="Method" value={fulfillment==="pickup"?"Pickup":"Delivery"}/>{fulfillment==="delivery"?<FinanceLine label="Deliver to" value={asString(selectedAddress??{},"formatted_address","display_name","address")??"Choose address"}/>:null}</View>
    <View style={{height:1,backgroundColor:palette.border}}/>
    <View style={{gap:7,backgroundColor:palette.surfaceSubtle,padding:13,borderRadius:14}}><FinanceLine label="Subtotal" value={money(subtotal,currency)}/>{fulfillment==="delivery"?<FinanceLine label="Delivery fee" value={money(deliveryFee,currency)}/>:null}<FinanceLine label="Total to pay" value={money(total,currency)} strong/></View>
    <View style={{gap:5}}><FinanceLine label="SKIMA Wallet balance" value={money(balance,currency)}/>{!walletId?<Notice text="Your SKIMA Wallet is unavailable right now." tone="error"/>:null}{balance<total?<Notice text="Your wallet balance is too low. Add funds before placing this order." tone="warning"/>:null}{subtotal<minimum?<Notice text={"The minimum order amount is "+money(minimum,currency)+"."} tone="warning"/>:null}</View>
    <View style={{flexDirection:"row",gap:8}}><View style={{flex:1}}><ActionButton label="Edit delivery" variant="secondary" disabled={checkout.isPending} onPress={()=>setCheckoutStep("fulfillment")}/></View><View style={{flex:1}}><ActionButton label="Edit basket" variant="quiet" disabled={checkout.isPending} onPress={()=>setCheckoutStep("basket")}/></View></View>
    <AppButton label={"Pay securely · "+money(total,currency)} fullWidth disabled={!canCheckout} loading={checkout.isPending} onPress={()=>checkout.mutate()}/>
    <Text style={{fontSize:9,color:palette.muted,textAlign:"center",lineHeight:14}}>Your payment is reserved securely. The merchant settlement is released only after you confirm receipt.</Text>
   </Card>:null}
   {notice?<Notice text={notice} tone="success"/>:null}
  </>}
 <StorefrontDetailSheet visible={Boolean(selectedProduct)} onClose={()=>setSelectedProduct(null)} palette={palette} title={selectedProduct?.name??"Product details"} media={selectedProduct?<StoreImage assetId={selectedProduct.imageAssetId} label={selectedProduct.name}/>:null} categoryLabel={selectedProduct?asString(selectedProduct.item,"category_name","category")??"SKIMA Store":undefined} description={selectedProduct?.description} priceLabel={selectedProduct?money(selectedProduct.amount,selectedProduct.currency):null} compareAtLabel={selectedProduct&&selectedProduct.compareAtAmount!==null&&selectedProduct.compareAtAmount>selectedProduct.amount?money(selectedProduct.compareAtAmount,selectedProduct.currency):null} stockLabel={selectedProduct?(selectedProduct.stock===null?"Available":selectedProduct.stock+" in stock"):null} footer={selectedProduct?<AppButton label="Add to basket" fullWidth disabled={checkout.isPending} onPress={()=>{const p=selectedProduct;setCheckoutKey(makeIdempotencyKey("store-checkout"));setCart(cur=>{const found=cur.find(x=>x.itemId===p.id&&x.variantId===p.variantId);if(found)return cur.map(x=>x===found?{...x,quantity:p.stock===null?x.quantity+1:Math.min(p.stock,x.quantity+1)}:x);return [...cur,{itemId:p.id,variantId:p.variantId,name:p.name,variantName:p.variantName,quantity:1,unitAmount:p.amount,currencyCode:p.currency,stock:p.stock}];});setSelectedProduct(null);}}/>:null}/>
  </Page>;
}
function CategoryChip({title,selected,onPress}:{title:string;selected:boolean;onPress:()=>void}){const {palette}=useAppTheme();return <Pressable onPress={onPress} style={{borderRadius:13,borderWidth:1,borderColor:selected?palette.brand:palette.border,backgroundColor:selected?palette.brandSoft:palette.surface,paddingHorizontal:13,paddingVertical:9}}><Text style={{fontSize:10,fontWeight:"900",color:selected?palette.brand:palette.ink}}>{title}</Text></Pressable>;}
function FinanceLine({label,value,strong=false}:{label:string;value:string;strong?:boolean}){const {palette}=useAppTheme();return <View style={{flexDirection:"row",justifyContent:"space-between"}}><Text style={{fontSize:10,color:palette.muted}}>{label}</Text><Text style={{fontSize:11,color:palette.ink,fontWeight:strong?"900":"700"}}>{value}</Text></View>;}
function StoreImage({assetId,label}:{assetId:string|null;label:string}){
 const session=useSession();const {palette}=useAppTheme();
 const query=useQuery({queryKey:["store-media",assetId,session.session?.user.id],enabled:Boolean(assetId&&session.status==="authenticated"),queryFn:()=>session.api.post("/runtime/media/read-sessions",{assetId,idempotencyKey:"store-media:"+assetId},MediaSchema)});
 return <View style={{flex:1,alignItems:"center",justifyContent:"center",backgroundColor:palette.surfaceSubtle}}>{query.data?.signedUrl?<Image source={{uri:query.data.signedUrl}} resizeMode="cover" style={{width:"100%",height:"100%"}} accessibilityLabel={label}/>:<ShoppingBag size={25} color={palette.brand}/>}</View>;
}
const styles=StyleSheet.create({basketLine:{minHeight:68,flexDirection:"row",alignItems:"center",gap:10,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:"#80808040",paddingVertical:7},basketThumb:{width:48,height:48,borderRadius:13,backgroundColor:"#80808016",alignItems:"center",justifyContent:"center"},quantityControl:{flexDirection:"row",alignItems:"center",gap:9,borderRadius:12,backgroundColor:"#80808016",paddingHorizontal:6,paddingVertical:5},quantityButton:{width:27,height:27,borderRadius:9,alignItems:"center",justifyContent:"center"},search:{minHeight:45,borderWidth:1,borderRadius:14,paddingHorizontal:11,flexDirection:"row",alignItems:"center",gap:9},grid:{flexDirection:"row",flexWrap:"wrap",gap:8},product:{borderWidth:StyleSheet.hairlineWidth,borderRadius:17,padding:9,gap:6},media:{height:110,borderRadius:12,overflow:"hidden"},cartLine:{minHeight:55,flexDirection:"row",alignItems:"center",gap:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:"#80808040"},address:{borderWidth:1,borderRadius:12,padding:10},note:{borderWidth:1,borderRadius:12,minHeight:42,padding:10,fontSize:11}});
