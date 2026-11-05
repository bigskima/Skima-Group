import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActivityIndicator, Alert, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { ArrowLeft, Minus, Plus, Search, ShoppingBag, ShoppingCart, X } from "lucide-react-native";
import { z } from "zod";
import { useSession } from "../session/SessionProvider";
import { useStorefrontData, useBillsRecords, asNumber, asString, money, makeIdempotencyKey } from "../api/bills";
import { useAppTheme } from "../theme/ThemeProvider";
import { Page, Card, SectionTitle, ActionButton, State, Notice } from "./BillsUI";
import { AppButton } from "../ui/AppButton";

type Row=Record<string,unknown>;
type CartLine={itemId:string;variantId:string|null;name:string;variantName:string|null;quantity:number;unitAmount:number;currencyCode:string;stock:number|null};
type Product={item:Row;id:string;variantId:string|null;name:string;variantName:string|null;description:string|null;amount:number;compareAtAmount:number|null;currency:string;stock:number|null;imageAssetId:string|null};
const OrderSchema=z.union([z.string(),z.record(z.string(),z.unknown())]);
const ActionSchema=z.union([z.string(),z.record(z.string(),z.unknown()),z.null()]);
const MediaSchema=z.object({assetId:z.string(),contentType:z.string().nullable(),expiresInSeconds:z.number().positive(),signedUrl:z.string().url()});
const record=(v:unknown):Row=>v&&typeof v==="object"&&!Array.isArray(v)?v as Row:{};
const metadata=(v:Row)=>record(v.metadata);
function effective(row:Row,now:number){const from=typeof row.effective_from==="string"?Date.parse(row.effective_from):null;const until=typeof row.effective_until==="string"?Date.parse(row.effective_until):null;return(from===null||!Number.isFinite(from)||from<=now)&&(until===null||!Number.isFinite(until)||until>now);}
function isCartLine(v:unknown):v is CartLine{const r=record(v);return typeof r.itemId==="string"&&typeof r.name==="string"&&typeof r.quantity==="number"&&r.quantity>0&&typeof r.unitAmount==="number"&&typeof r.currencyCode==="string"&&(r.variantId===null||typeof r.variantId==="string");}

export function BillsStoreScreen(){
 const session=useSession();const {palette}=useAppTheme();const {width}=useWindowDimensions();const cache=useQueryClient();
 const store=useStorefrontData();
 const wallets=useBillsRecords(["store","wallets"],"/runtime/wallets",true,30000);
 const balances=useBillsRecords(["store","balances"],"/runtime/wallet-balances",true,20000);
 const locations=useBillsRecords(["store","locations"],"/lpg/locations",true,60000);
 const orders=useBillsRecords(["store","orders"],"/runtime/storefront/orders",true,15000);
 const userId=session.session?.user.id??"";
 const moduleId=asString(store.storeModule,"id");
 const cartKey="skima:bills:store:v1:"+userId+":"+(moduleId??"unconfigured");
 const [cart,setCart]=useState<CartLine[]>([]);const [cartReady,setCartReady]=useState(false);const [loadedKey,setLoadedKey]=useState("");
 const [search,setSearch]=useState("");const [category,setCategory]=useState("all");const [fulfillment,setFulfillment]=useState<"delivery"|"pickup">("delivery");
 const [locationId,setLocationId]=useState("");const [note,setNote]=useState("");const [notice,setNotice]=useState("");
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
 const checkout=useMutation({
  mutationFn:async()=>{
   if(!canCheckout)throw new Error("Choose a valid fulfilment option and funded shared SKIMA Wallet before checkout.");
   return session.api.post("/runtime/storefront/checkout",{lineItems:cart.map(l=>({itemId:l.itemId,variantId:l.variantId,quantity:l.quantity})),customerWalletId:walletId,fulfillmentMethod:fulfillment,deliveryLocationId:fulfillment==="delivery"?locationId:null,customerNote:note.trim()||null,idempotencyKey:makeIdempotencyKey("bills-store-checkout")},OrderSchema);
  },
  onSuccess:async(result)=>{const obj=record(result);const orderId=asString(obj,"orderId")??(typeof result==="string"?result:"");setCart([]);setNote("");setNotice(orderId?"Your order "+orderId.slice(0,8).toUpperCase()+" was received. The amount is reserved in SKIMA checkout escrow.":"Your Store order was submitted. The shared wallet and order status are being updated.");await Promise.all([wallets.refetch(),balances.refetch(),orders.refetch()]);await cache.invalidateQueries({queryKey:["skima-bills"]});},
  onError:(error)=>Alert.alert("Checkout unavailable",error instanceof Error?error.message:"Please review your basket and try again.")
 });
 const receipt=useMutation({mutationFn:(id:string)=>session.api.post("/runtime/storefront/orders/confirm-receipt",{orderId:id,idempotencyKey:"bills-store-receipt:"+id},ActionSchema),onSuccess:async()=>{await orders.refetch();await wallets.refetch();await balances.refetch();Alert.alert("Receipt confirmed","Your Store receipt has been saved.");}});
 const refresh=()=>void Promise.all([store.items.refetch(),store.prices.refetch(),store.availability.refetch(),orders.refetch(),wallets.refetch(),balances.refetch()]);
 const busy=store.modules.isPending||store.settings.isPending;
 if(busy)return <Page><State title="Opening SKIMA Store" body="Loading the shared Store configuration."/></Page>;
 if(!store.storeModule||!settings)return <Page><State title="Store is not currently available" body="SKIMA Store will appear here when the platform administrator enables it."/></Page>;
 return <Page refreshControl={<RefreshControl refreshing={store.items.isRefetching||store.prices.isRefetching} onRefresh={refresh} tintColor={palette.brand}/>}>
  <Card style={{backgroundColor:palette.brand,borderColor:palette.brand,padding:17}}><Text style={{fontSize:9,color:"rgba(255,255,255,.75)",fontWeight:"900",letterSpacing:1.2}}>SKIMA STORE</Text><Text style={{fontSize:23,color:"#fff",fontWeight:"900"}}>Shop essentials.</Text><Text style={{fontSize:11,color:"rgba(255,255,255,.85)"}}>One catalogue. Live availability. Shared checkout.</Text><Text style={{fontSize:10,color:"#fff",marginTop:5}}>Wallet · {money(balance,currency)}</Text></Card>
  <View style={[styles.search,{borderColor:palette.border,backgroundColor:palette.surface}]}><Search size={16} color={palette.muted}/><TextInput value={search} onChangeText={setSearch} placeholder="Search products" placeholderTextColor={palette.muted} style={{flex:1,color:palette.ink,fontSize:12}}/>{search?<Pressable onPress={()=>setSearch("")}><X size={16} color={palette.muted}/></Pressable>:null}</View>
  <SectionTitle title="Shop by category" caption="Browse the shared catalogue available to Bills customers."/>
  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}><CategoryChip title="All" selected={category==="all"} onPress={()=>setCategory("all")}/>{categories.map(c=><CategoryChip key={asString(c,"id")??""} title={asString(c,"display_name","name")??"Category"} selected={category===asString(c,"id")} onPress={()=>setCategory(asString(c,"id")??"all")}/>)}</ScrollView>
  {store.items.isPending||store.prices.isPending||store.availability.isPending?<State title="Loading products" body="Reading live prices and stock availability."/>:store.items.error||store.prices.error||store.availability.error?<State title="Products unavailable" body="Try refreshing the shared catalogue." retry={refresh}/>:filtered.length?<View style={styles.grid}>{filtered.map(p=><View key={p.id+":"+(p.variantId??"base")} style={[styles.product,{backgroundColor:palette.surface,borderColor:palette.border,width:width>=1100?"23.8%":width>=700?"31.8%":"48.5%"}]}>
    <View style={styles.media}><StoreImage assetId={p.imageAssetId} label={p.name}/></View>
    <Text style={{color:palette.muted,fontSize:9}} numberOfLines={1}>{asString(p.item,"category_name","category")??"SKIMA Store"}</Text>
    <Text style={{color:palette.ink,fontSize:11,fontWeight:"900"}} numberOfLines={2}>{p.name}</Text>
    {p.variantName?<Text style={{color:palette.muted,fontSize:9}}>{p.variantName}</Text>:null}
    <Text style={{fontSize:12,color:palette.ink,fontWeight:"900"}}>{money(p.amount,p.currency)}</Text>
    <Text style={{fontSize:9,color:palette.success,fontWeight:"800"}}>{p.stock===null?"Available":p.stock+" in stock"}</Text>
    <ActionButton small label="Add to basket" onPress={()=>setCart(cur=>{const found=cur.find(x=>x.itemId===p.id&&x.variantId===p.variantId);if(found)return cur.map(x=>x===found?{...x,quantity:p.stock===null?x.quantity+1:Math.min(p.stock,x.quantity+1)}:x);return [...cur,{itemId:p.id,variantId:p.variantId,name:p.name,variantName:p.variantName,quantity:1,unitAmount:p.amount,currencyCode:p.currency,stock:p.stock}];})}/>
   </View>)}</View>:<State title="No products available" body="Products appear when they have an active price and available stock."/>}
  <Card>
   <SectionTitle title={"Your basket · "+cart.reduce((s,l)=>s+l.quantity,0)+" items"} caption={cart.length?money(subtotal,cartCurrency):"Add a product to start shopping."}/>
   {cart.length?cart.map(line=><View key={line.itemId+":"+(line.variantId??"base")} style={styles.cartLine}><View style={{flex:1,gap:2}}><Text style={{color:palette.ink,fontSize:11,fontWeight:"900"}}>{line.name}</Text>{line.variantName?<Text style={{color:palette.muted,fontSize:9}}>{line.variantName}</Text>:null}<Text style={{color:palette.muted,fontSize:10}}>{money(line.unitAmount*line.quantity,line.currencyCode)}</Text></View><Pressable onPress={()=>setCart(cur=>cur.map(x=>x.itemId===line.itemId&&x.variantId===line.variantId?{...x,quantity:Math.max(0,x.quantity-1)}:x).filter(x=>x.quantity>0))}><Minus size={16} color={palette.muted}/></Pressable><Text style={{fontSize:11,color:palette.ink,fontWeight:"900"}}>{line.quantity}</Text><Pressable onPress={()=>setCart(cur=>cur.map(x=>x.itemId===line.itemId&&x.variantId===line.variantId?{...x,quantity:x.stock===null?x.quantity+1:Math.min(x.stock,x.quantity+1)}:x))}><Plus size={16} color={palette.brand}/></Pressable></View>):null}
   {cart.length?<View style={{gap:10}}>
    <SectionTitle title="Fulfilment"/>
    <View style={{flexDirection:"row",gap:8}}>{allowedMethods.includes("delivery")?<View style={{flex:1}}><ActionButton small label="Delivery" variant={fulfillment==="delivery"?"primary":"secondary"} onPress={()=>setFulfillment("delivery")}/></View>:null}{allowedMethods.includes("pickup")?<View style={{flex:1}}><ActionButton small label="Pickup" variant={fulfillment==="pickup"?"primary":"secondary"} onPress={()=>setFulfillment("pickup")}/></View>:null}</View>
    {fulfillment==="delivery"?<View style={{gap:8}}><Text style={{color:palette.ink,fontSize:11,fontWeight:"900"}}>Delivery address</Text>{addresses.slice(0,6).map(a=><Pressable key={asString(a,"id")??""} onPress={()=>setLocationId(asString(a,"id")??"")} style={[styles.address,{backgroundColor:locationId===asString(a,"id")?palette.brandSoft:palette.surfaceSubtle,borderColor:locationId===asString(a,"id")?palette.brand:palette.border}]}><Text style={{color:palette.ink,fontSize:10,fontWeight:"700"}}>{asString(a,"formatted_address","display_name","address")??"Saved address"}</Text></Pressable>)}{!addresses.length?<Text style={{color:palette.muted,fontSize:10}}>Add a saved address or use pickup.</Text>:null}</View>:null}
    <TextInput value={note} onChangeText={setNote} placeholder="Order note (optional)" placeholderTextColor={palette.muted} style={[styles.note,{borderColor:palette.border,color:palette.ink}]}/>
    <View style={{gap:6,backgroundColor:palette.surfaceSubtle,padding:11,borderRadius:13}}><FinanceLine label="Subtotal" value={money(subtotal,currency)}/>{fulfillment==="delivery"?<FinanceLine label="Delivery fee" value={money(deliveryFee,currency)}/>:null}<FinanceLine label="Total" value={money(total,currency)} strong/></View>
    {!walletId?<Notice text="Your shared customer wallet is unavailable." tone="error"/>:null}
    {balance<total?<Notice text="Your shared wallet balance cannot cover this order. Add funds to continue." tone="warning"/>:null}
    {subtotal<minimum?<Notice text={"The minimum order amount is "+money(minimum,currency)+"."} tone="warning"/>:null}
    <Pressable onPress={()=>Alert.alert("Shared SKIMA Wallet","Your Bills and Store purchases use the existing customer wallet.")}><Text style={{fontSize:10,color:palette.brand,fontWeight:"900"}}>Using the same SKIMA Wallet as Bills · Refill · Logistics</Text></Pressable>
    <AppButton label={"Pay "+money(total,currency)} fullWidth disabled={!canCheckout} loading={checkout.isPending} onPress={()=>checkout.mutate()}/>
   </View>:null}
  </Card>
  <View style={{gap:9}}><SectionTitle title="Your Store orders" caption="Track deliveries and confirm receipt."/>
   {orders.isPending?<ActivityIndicator color={palette.brand}/>:orders.error?<State title="Orders unavailable" body="Your previous Store orders are safe. Try again." retry={()=>void orders.refetch()}/>:orders.data?.length?orders.data.slice(0,6).map(o=><Card key={asString(o,"id")??""} style={{gap:7}}><View style={{flexDirection:"row",justifyContent:"space-between",gap:10}}><Text style={{fontSize:11,color:palette.ink,fontWeight:"900"}}>{"Order "+(asString(o,"id")??"").slice(0,8).toUpperCase()}</Text><Text style={{fontSize:10,color:palette.brand,fontWeight:"900"}}>{(asString(o,"status")??"received").replaceAll("_"," ")}</Text></View><Text style={{fontSize:10,color:palette.muted}}>{asString(o,"fulfillment_method")??"delivery"} · {money(asNumber(o,"total_amount")??0,asString(o,"currency_code")??currency)}</Text>{asString(o,"status")==="fulfilled"?<ActionButton small label="Confirm receipt" onPress={()=>receipt.mutate(asString(o,"id")??"")} loading={receipt.isPending}/>:null}{asString(o,"status")==="completed"?<Text style={{fontSize:10,color:palette.success,fontWeight:"800"}}>Receipt confirmed · settlement completed</Text>:null}</Card>):<State title="No Store orders yet" body="Orders placed from Bills will appear here alongside your SKIMA Store purchases."/>}
  </View>
  {notice?<Notice text={notice} tone="success"/>:null}
 </Page>;
}
function CategoryChip({title,selected,onPress}:{title:string;selected:boolean;onPress:()=>void}){const {palette}=useAppTheme();return <Pressable onPress={onPress} style={{borderRadius:13,borderWidth:1,borderColor:selected?palette.brand:palette.border,backgroundColor:selected?palette.brandSoft:palette.surface,paddingHorizontal:13,paddingVertical:9}}><Text style={{fontSize:10,fontWeight:"900",color:selected?palette.brand:palette.ink}}>{title}</Text></Pressable>;}
function FinanceLine({label,value,strong=false}:{label:string;value:string;strong?:boolean}){const {palette}=useAppTheme();return <View style={{flexDirection:"row",justifyContent:"space-between"}}><Text style={{fontSize:10,color:palette.muted}}>{label}</Text><Text style={{fontSize:11,color:palette.ink,fontWeight:strong?"900":"700"}}>{value}</Text></View>;}
function StoreImage({assetId,label}:{assetId:string|null;label:string}){
 const session=useSession();const {palette}=useAppTheme();
 const query=useQuery({queryKey:["bills-store-media",assetId,session.session?.user.id],enabled:Boolean(assetId&&session.status==="authenticated"),queryFn:()=>session.api.post("/runtime/media/read-sessions",{assetId,idempotencyKey:"bills-store-media:"+assetId},MediaSchema)});
 return <View style={{flex:1,alignItems:"center",justifyContent:"center",backgroundColor:palette.surfaceSubtle}}>{query.data?.signedUrl?<Image source={{uri:query.data.signedUrl}} resizeMode="cover" style={{width:"100%",height:"100%"}} accessibilityLabel={label}/>:<ShoppingBag size={25} color={palette.brand}/>}</View>;
}
const styles=StyleSheet.create({search:{minHeight:45,borderWidth:1,borderRadius:14,paddingHorizontal:11,flexDirection:"row",alignItems:"center",gap:9},grid:{flexDirection:"row",flexWrap:"wrap",gap:8},product:{borderWidth:StyleSheet.hairlineWidth,borderRadius:17,padding:9,gap:6},media:{height:110,borderRadius:12,overflow:"hidden"},cartLine:{minHeight:55,flexDirection:"row",alignItems:"center",gap:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:"#80808040"},address:{borderWidth:1,borderRadius:12,padding:10},note:{borderWidth:1,borderRadius:12,minHeight:42,padding:10,fontSize:11}});
