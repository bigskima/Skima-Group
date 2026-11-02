import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Minus,
  PackageCheck,
  Plus,
  Search,
  ShoppingBag,
  ShoppingCart,
  Tag,
  Trash2,
  X,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { z } from "zod";
import { useStorefrontData } from "../../src/native/api/store";
import {
  type PlatformRecord,
} from "../../src/native/api/records";
import { RuntimeMediaImage } from "../../src/native/ui/RuntimeMediaImage";
import { ScreenSkeleton } from "../../src/native/ui/ScreenSkeleton";
import { useSession } from "../../src/native/session/SessionProvider";
import { idempotencyKey } from "../../src/native/utilities/idempotency";
import { useAppTheme } from "../../src/native/theme/ThemeProvider";
import { borders, radii, spacing, typography } from "../../src/native/theme/tokens";

type StoreCartLine = {
  itemId: string;
  variantId: string | null;
  itemName: string;
  variantName: string | null;
  quantity: number;
  unitAmount: number;
  compareAtAmount: number | null;
  currencyCode: string;
};

const ORDER_RESULT_SCHEMA = z.union([z.string(), z.record(z.unknown())]);

export default function StoreScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const data = useStorefrontData();
  const userId = session.context?.user.id ?? session.session?.user.id ?? "anonymous";
  const cartStorageKey = `skima:store:cart:v1:${userId}`;
  const [checkoutAttemptKey, setCheckoutAttemptKey] = useState(() => idempotencyKey("store-order", userId));
  const [cart, setCart] = useState<StoreCartLine[]>([]);
  const [cartReady, setCartReady] = useState(false);
  const [loadedCartKey, setLoadedCartKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryKey, setCategoryKey] = useState("all");
  const [selectedItem, setSelectedItem] = useState<PlatformRecord | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setCart([]);
    setCartReady(false);
    setLoadedCartKey(null);
    void AsyncStorage.getItem(cartStorageKey).then((stored) => {
      if (!active) return;
      if (stored) {
        try {
          const parsed: unknown = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            setCart(parsed.filter(isCartLine));
          }
        } catch {
          setCart([]);
        }
      }
      setLoadedCartKey(cartStorageKey);
      setCartReady(true);
    }).catch(() => {
      if (active) {
        setLoadedCartKey(cartStorageKey);
        setCartReady(true);
      }
    });
    return () => { active = false; };
  }, [cartStorageKey]);

  useEffect(() => {
    if (!cartReady || loadedCartKey !== cartStorageKey) return;
    void AsyncStorage.setItem(cartStorageKey, JSON.stringify(cart)).catch(() => undefined);
  }, [cart, cartReady, cartStorageKey, loadedCartKey]);

  const settings = data.activeSettings;
  const storeModuleId = typeof data.storeModule?.id === "string" ? data.storeModule.id : null;
  const categories = useMemo(() =>
    (data.categories.data ?? []).filter((category) =>
      category.module_id === storeModuleId && category.status === "active"
    ), [data.categories.data, storeModuleId]);

  const products = useMemo(() => {
    if (!settings || !storeModuleId) return [];
    const configuredMethods = Array.isArray(settings.fulfillment_methods)
      ? settings.fulfillment_methods.filter((method): method is string => typeof method === "string")
      : [];
    const now = Date.now();
    return (data.items.data ?? [])
      .filter((item) =>
        item.module_id === storeModuleId &&
        item.organization_id === settings.organization_id &&
        item.status === "active" &&
        metadataValue(item, "sales_channel") === "skima_store" &&
        (configuredMethods.length === 0 ||
          !Array.isArray(item.fulfillment_methods) ||
          configuredMethods.some((method) => item.fulfillment_methods?.includes(method)))
      )
      .map((item) => {
        const itemId = recordString(item, "id");
        const variants = (data.variants.data ?? []).filter((variant) =>
          variant.item_id === itemId && variant.status === "active"
        );
        const itemPrices = (data.prices.data ?? []).filter((price) =>
          price.item_id === itemId &&
          price.currency_code === settings.currency_code &&
          price.status === "active" &&
          isEffective(price, now)
        );
        const itemAvailability = (data.availability.data ?? []).filter((rule) =>
          rule.item_id === itemId &&
          rule.status === "active" &&
          isEffective(rule, now)
        );
        const itemMedia = (data.media.data ?? []).filter((media) =>
          media.item_id === itemId && media.status === "active"
        ).sort((left, right) => numberValue(left.display_order) - numberValue(right.display_order));
        const basePrice = chooseRecord(itemPrices, null);
        const stockRule = chooseRecord(itemAvailability, null);
        const hasValidPrice = variants.length
          ? variants.some((variant) =>
              Boolean(chooseRecord(itemPrices, recordString(variant, "id")) ?? basePrice)
            )
          : Boolean(basePrice);
        const hasAvailableStock = variants.length
          ? variants.some((variant) => {
              const variantRule = chooseRecord(itemAvailability, recordString(variant, "id")) ?? stockRule;
              return Boolean(variantRule && isInStock(variantRule));
            })
          : Boolean(stockRule && isInStock(stockRule));
        const available = item.status === "active" && hasValidPrice && hasAvailableStock;
        return {
          ...item,
          _id: itemId,
          _variants: variants,
          _prices: itemPrices,
          _availability: itemAvailability,
          _imageAssetId: typeof itemMedia[0]?.media_asset_id === "string" ? itemMedia[0].media_asset_id : null,
          _available: available,
        };
      })
      .filter((item) => item._id && item._available);
  }, [
    data.items.data,
    data.variants.data,
    data.prices.data,
    data.availability.data,
    data.media.data,
    settings,
    storeModuleId,
  ]);

  const visibleProducts = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return products.filter((item) => {
      const inCategory = categoryKey === "all" || recordString(item, "category_id") === categoryKey;
      const searchable = `${recordString(item, "display_name")} ${recordString(item, "description")}`.toLowerCase();
      return inCategory && (!normalizedSearch || searchable.includes(normalizedSearch));
    });
  }, [products, search, categoryKey]);

  const selectedVariants = selectedItem
    ? (data.variants.data ?? []).filter((variant) =>
        variant.item_id === recordString(selectedItem, "id") && variant.status === "active"
      )
    : [];
  const chosenVariant = selectedVariants.find((variant) =>
    recordString(variant, "id") === selectedVariantId
  ) ?? null;
  const selectedItemId = selectedItem ? recordString(selectedItem, "id") : "";
  const selectedPrice = selectedItem
    ? chooseRecord(
        (data.prices.data ?? []).filter((price) =>
          price.item_id === selectedItemId &&
          price.currency_code === settings?.currency_code &&
          price.status === "active" &&
          isEffective(price, Date.now())
        ),
        selectedVariantId,
      ) ?? (selectedVariantId ? chooseRecord(
        (data.prices.data ?? []).filter((price) =>
          price.item_id === selectedItemId &&
          price.currency_code === settings?.currency_code &&
          price.status === "active" &&
          isEffective(price, Date.now())
        ),
        null,
      ) : null)
    : null;
  const selectedAvailability = selectedItem
    ? chooseRecord(
        (data.availability.data ?? []).filter((rule) =>
          rule.item_id === selectedItemId &&
          rule.status === "active" &&
          isEffective(rule, Date.now())
        ),
        selectedVariantId,
      ) ?? chooseRecord(
        (data.availability.data ?? []).filter((rule) =>
          rule.item_id === selectedItemId &&
          rule.status === "active" &&
          isEffective(rule, Date.now())
        ),
        null,
      )
    : null;
  const selectedStock = remainingStock(selectedAvailability);
  const selectedAvailable = Boolean(selectedPrice) &&
    (selectedAvailability === null || isInStock(selectedAvailability));
  const selectedMax = Math.min(
    99,
    selectedStock ?? 99,
    positiveNumber(chosenVariant?.max_quantity) ?? positiveNumber(selectedItem?.max_quantity) ?? 99,
  );
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const cartTotal = cart.reduce((sum, line) => sum + line.quantity * line.unitAmount, 0);
  const currencyCode = typeof settings?.currency_code === "string" ? settings.currency_code : "NGN";

  const checkout = useMutation({
    mutationFn: async () => {
      if (!settings || !cart.length) throw new Error("Add a product before checking out.");
      const lineItems = cart.map((line) => ({
        itemId: line.itemId,
        variantId: line.variantId,
        quantity: line.quantity,
      }));
      return session.api.post(
        "/runtime/orders",
        {
          moduleKey: "store",
          organizationId: settings.organization_id,
          branchId: settings.branch_id ?? null,
          currencyCode: settings.currency_code,
          fulfillmentMethod: settings.fulfillment_method,
          acceptancePolicyKey: "store.order.acceptance.manual.v1",
          lineItems,
          orderPayload: {
            channel: "skima_store",
            fulfillment_method: settings.fulfillment_method,
            customer_note: null,
          },
          metadata: {
            customer_app: "skima.lpg.mobile",
            storefront_module: "store",
          },
          source: "skima.store.customer",
          idempotencyKey: checkoutAttemptKey,
        },
        ORDER_RESULT_SCHEMA,
      );
    },
    onSuccess: async (result) => {
      const orderId = typeof result === "string"
        ? result
        : typeof result.id === "string"
          ? result.id
          : typeof result.orderId === "string"
            ? result.orderId
            : "received";
      setCart([]);
      setCheckoutAttemptKey(idempotencyKey("store-order", userId));
      setCartOpen(false);
      Alert.alert(
        "Order request received",
        `Your SKIMA Store order ${orderId === "received" ? "has been received" : `(${orderId.slice(0, 8).toUpperCase()}) has been received`}. The Store team will confirm the order and the next fulfillment/payment step.`,
      );
    },
    onError: (error) => {
      Alert.alert(
        "Order could not be submitted",
        error instanceof Error ? error.message : "Please review your basket and try again.",
      );
    },
  });

  function openProduct(item: PlatformRecord) {
    const variants = (data.variants.data ?? []).filter((variant) =>
      variant.item_id === recordString(item, "id") && variant.status === "active"
    );
    setSelectedItem(item);
    setSelectedVariantId(variants.length ? recordString(variants[0], "id") : null);
    setSelectedQuantity(1);
  }

  function addSelectedToCart() {
    if (!selectedItem || !selectedPrice || !selectedAvailable || !settings) return;
    const itemId = recordString(selectedItem, "id");
    const variantId = selectedVariantId;
    const available = selectedStock ?? 99;
    if (selectedQuantity > available) {
      Alert.alert("Stock changed", "Reduce the quantity and try again.");
      return;
    }
    const line: StoreCartLine = {
      itemId,
      variantId,
      itemName: recordString(selectedItem, "display_name"),
      variantName: chosenVariant ? recordString(chosenVariant, "display_name") : null,
      quantity: selectedQuantity,
      unitAmount: numberValue(selectedPrice.amount),
      compareAtAmount: optionalNumber(selectedPrice.compare_at_amount),
      currencyCode,
    };
    setCart((current) => {
      const found = current.find((candidate) =>
        candidate.itemId === itemId && candidate.variantId === variantId
      );
      if (!found) return [...current, line];
      return current.map((candidate) =>
        candidate.itemId === itemId && candidate.variantId === variantId
          ? { ...candidate, quantity: candidate.quantity + selectedQuantity }
          : candidate
      );
    });
    setSelectedItem(null);
  }

  function adjustCartLine(itemId: string, variantId: string | null, delta: number) {
    setCart((current) => current
      .map((line) => line.itemId === itemId && line.variantId === variantId
        ? { ...line, quantity: line.quantity + delta }
        : line
      )
      .filter((line) => line.quantity > 0)
    );
  }

  const isLoading = data.modules.isPending || data.settings.isPending ||
    (Boolean(settings) && (data.items.isPending || data.prices.isPending || data.availability.isPending));
  const error = data.modules.error ?? data.settings.error ?? data.items.error ??
    data.prices.error ?? data.availability.error;

  return (
    <View style={[styles.screen, { backgroundColor: palette.canvas }]}>
      <View style={[styles.header, { backgroundColor: palette.surface, borderBottomColor: palette.border }]}>
        <Pressable onPress={() => router.back()} style={[styles.backButton, { backgroundColor: palette.surfaceSubtle }]}>
          <ArrowLeft color={palette.ink} size={19} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.headerEyebrow, { color: palette.brand }]}>SKIMA MARKETPLACE</Text>
          <Text style={[styles.headerTitle, { color: palette.ink }]}>Store</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open basket, ${cartCount} items`}
          onPress={() => setCartOpen(true)}
          style={[styles.cartButton, { backgroundColor: palette.brand }]}
        >
          <ShoppingBag color="#FFFFFF" size={20} />
          {cartCount > 0 ? <View style={styles.cartCount}><Text style={styles.cartCountText}>{cartCount > 99 ? "99+" : cartCount}</Text></View> : null}
        </Pressable>
      </View>

      {isLoading ? (
        <ScreenSkeleton cards={4} />
      ) : error ? (
        <View style={styles.centerState}>
          <PackageCheck color={palette.muted} size={34} />
          <Text style={[styles.emptyTitle, { color: palette.ink }]}>Store is unavailable</Text>
          <Text style={[styles.emptyBody, { color: palette.muted }]}>{error instanceof Error ? error.message : "The Store catalogue could not be loaded."}</Text>
          <Pressable onPress={() => void Promise.all([data.items.refetch(), data.settings.refetch(), data.prices.refetch()])} style={[styles.primaryButton, { backgroundColor: palette.brand }]}>
            <Text style={styles.primaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      ) : !settings || settings.status !== "active" ? (
        <View style={styles.centerState}>
          <ShoppingBag color={palette.muted} size={38} />
          <Text style={[styles.emptyTitle, { color: palette.ink }]}>SKIMA Store is getting ready</Text>
          <Text style={[styles.emptyBody, { color: palette.muted }]}>The Store team has not activated its operating catalogue yet. Your LPG and fuel services remain available from Home.</Text>
        </View>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.hero, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.heroCopy}>
                <Text style={[styles.heroEyebrow, { color: palette.brand }]}>MORE THAN REFILLS</Text>
                <Text style={[styles.heroTitle, { color: palette.ink }]}>Everyday essentials, in one place.</Text>
                <Text style={[styles.heroBody, { color: palette.muted }]}>Shop cylinders and other products listed by SKIMA. Prices, offers and availability are managed from the Store catalogue.</Text>
              </View>
              <View style={[styles.heroIcon, { backgroundColor: palette.brandSoft }]}>
                <ShoppingBag color={palette.brand} size={31} />
              </View>
            </View>

            <View style={[styles.searchBox, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <Search color={palette.muted} size={19} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search products"
                placeholderTextColor={palette.muted}
                style={[styles.searchInput, { color: palette.ink }]}
                returnKeyType="search"
              />
              {search ? <Pressable onPress={() => setSearch("")}><X color={palette.muted} size={18} /></Pressable> : null}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
              <CategoryChip label="All products" active={categoryKey === "all"} onPress={() => setCategoryKey("all")} />
              {categories.map((category) => {
                const key = recordString(category, "id");
                return <CategoryChip key={key} label={recordString(category, "display_name")} active={categoryKey === key} onPress={() => setCategoryKey(key)} />;
              })}
            </ScrollView>

            <View style={styles.sectionHeader}>
              <View>
                <Text style={[styles.sectionTitle, { color: palette.ink }]}>
                  {categoryKey === "all" ? "Shop all products" : categories.find((category) => recordString(category, "id") === categoryKey)?.display_name as string ?? "Products"}
                </Text>
                <Text style={[styles.sectionSubtitle, { color: palette.muted }]}>{visibleProducts.length} product{visibleProducts.length === 1 ? "" : "s"} available</Text>
              </View>
            </View>

            {visibleProducts.length ? (
              <View style={styles.productGrid}>
                {visibleProducts.map((item) => {
                  const basePrice = chooseRecord(item._prices, null);
                  const variantPrice = item._variants.length
                    ? chooseRecord(item._prices, recordString(item._variants[0], "id"))
                    : null;
                  const price = basePrice ?? variantPrice;
                  const amount = numberValue(price?.amount);
                  const compareAt = optionalNumber(price?.compare_at_amount);
                  const category = categories.find((candidate) => recordString(candidate, "id") === recordString(item, "category_id"));
                  const salePercent = compareAt && compareAt > amount
                    ? Math.round((1 - amount / compareAt) * 100)
                    : 0;
                  return (
                    <Pressable
                      key={item._id}
                      onPress={() => openProduct(item)}
                      style={[styles.productCard, { backgroundColor: palette.surface, borderColor: palette.border }]}
                    >
                      <View style={styles.productImage}>
                        {item._imageAssetId
                          ? <RuntimeMediaImage assetId={item._imageAssetId} label={recordString(item, "display_name")} variant="card" />
                          : <View style={[styles.imagePlaceholder, { backgroundColor: palette.surfaceSubtle }]}><ShoppingBag color={palette.muted} size={30} /></View>}
                        {salePercent > 0 ? <View style={[styles.discountBadge, { backgroundColor: palette.brand }]}><Text style={styles.discountText}>{salePercent}% OFF</Text></View> : null}
                      </View>
                      <View style={styles.productCopy}>
                        {category ? <Text style={[styles.productCategory, { color: palette.muted }]}>{recordString(category, "display_name")}</Text> : null}
                        <Text numberOfLines={2} style={[styles.productName, { color: palette.ink }]}>{recordString(item, "display_name")}</Text>
                        <View style={styles.productPriceRow}>
                          <Text style={[styles.productPrice, { color: palette.ink }]}>{formatMoney(amount, currencyCode)}</Text>
                          {compareAt && compareAt > amount ? <Text style={[styles.comparePrice, { color: palette.muted }]}>{formatMoney(compareAt, currencyCode)}</Text> : null}
                        </View>
                        <Pressable
                          onPress={() => openProduct(item)}
                          style={[styles.addButton, { backgroundColor: palette.brandSoft }]}
                        >
                          <Plus color={palette.brand} size={16} />
                          <Text style={[styles.addButtonText, { color: palette.brand }]}>{item._variants.length ? "Select options" : "Add to basket"}</Text>
                        </Pressable>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View style={[styles.emptyProducts, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <ShoppingBag color={palette.muted} size={28} />
                <Text style={[styles.emptyTitle, { color: palette.ink }]}>No products found</Text>
                <Text style={[styles.emptyBody, { color: palette.muted }]}>{search ? "Try a different search term or category." : "Products will appear here as soon as they are published in SKIMA Store."}</Text>
              </View>
            )}
          </ScrollView>
          {cartCount > 0 ? (
            <Pressable onPress={() => setCartOpen(true)} style={[styles.basketBar, { backgroundColor: palette.brand }]}>
              <View style={styles.basketCount}><Text style={styles.basketCountText}>{cartCount}</Text></View>
              <Text style={styles.basketText}>View basket</Text>
              <Text style={styles.basketTotal}>{formatMoney(cartTotal, currencyCode)}</Text>
              <ChevronRight color="#FFFFFF" size={18} />
            </Pressable>
          ) : null}
        </>
      )}

      <Modal transparent animationType="slide" visible={Boolean(selectedItem)} onRequestClose={() => setSelectedItem(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.productModal, { backgroundColor: palette.surface }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: palette.ink }]} numberOfLines={2}>{selectedItem ? recordString(selectedItem, "display_name") : "Product"}</Text>
              <Pressable onPress={() => setSelectedItem(null)} style={[styles.closeButton, { backgroundColor: palette.surfaceSubtle }]}><X color={palette.ink} size={19} /></Pressable>
            </View>
            {selectedItem?._imageAssetId ? <RuntimeMediaImage assetId={selectedItem._imageAssetId as string} label={recordString(selectedItem, "display_name")} variant="hero" /> : null}
            {selectedItem && recordString(selectedItem, "description") ? <Text style={[styles.modalDescription, { color: palette.muted }]}>{recordString(selectedItem, "description")}</Text> : null}
            {selectedVariants.length ? (
              <View style={styles.optionSection}>
                <Text style={[styles.optionLabel, { color: palette.ink }]}>Choose an option</Text>
                <View style={styles.optionList}>
                  {selectedVariants.map((variant) => {
                    const variantId = recordString(variant, "id");
                    const active = selectedVariantId === variantId;
                    const variantPrice = chooseRecord(
                      (data.prices.data ?? []).filter((price) =>
                        price.item_id === selectedItemId &&
                        price.currency_code === currencyCode &&
                        price.status === "active" &&
                        isEffective(price, Date.now())
                      ),
                      variantId,
                    ) ?? chooseRecord(
                      (data.prices.data ?? []).filter((price) =>
                        price.item_id === selectedItemId &&
                        price.currency_code === currencyCode &&
                        price.status === "active" &&
                        isEffective(price, Date.now())
                      ),
                      null,
                    );
                    return (
                      <Pressable key={variantId} onPress={() => setSelectedVariantId(variantId)} style={[styles.optionButton, { borderColor: active ? palette.brand : palette.border, backgroundColor: active ? palette.brandSoft : palette.surface }]}>
                        <View style={styles.optionRadio}>{active ? <Check color={palette.brand} size={13} /> : null}</View>
                        <Text style={[styles.optionName, { color: palette.ink }]}>{recordString(variant, "display_name")}</Text>
                        <Text style={[styles.optionPrice, { color: palette.ink }]}>{variantPrice ? formatMoney(numberValue(variantPrice.amount), currencyCode) : "Price unavailable"}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
            <View style={styles.modalFooter}>
              <View style={styles.quantityPicker}>
                <Pressable onPress={() => setSelectedQuantity((value) => Math.max(1, value - 1))} style={[styles.quantityButton, { borderColor: palette.border }]}><Minus color={palette.ink} size={16} /></Pressable>
                <Text style={[styles.quantityValue, { color: palette.ink }]}>{selectedQuantity}</Text>
                <Pressable onPress={() => setSelectedQuantity((value) => Math.min(selectedMax, value + 1))} disabled={selectedQuantity >= selectedMax} style={[styles.quantityButton, { borderColor: palette.border, opacity: selectedQuantity >= selectedMax ? 0.4 : 1 }]}><Plus color={palette.ink} size={16} /></Pressable>
              </View>
              <Pressable disabled={!selectedAvailable || !selectedPrice || selectedMax < 1} onPress={addSelectedToCart} style={[styles.primaryButton, { backgroundColor: palette.brand, opacity: !selectedAvailable || !selectedPrice ? 0.5 : 1 }]}>
                <Text style={styles.primaryButtonText}>{selectedPrice ? `Add · ${formatMoney(numberValue(selectedPrice.amount) * selectedQuantity, currencyCode)}` : "Price unavailable"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent animationType="slide" visible={cartOpen} onRequestClose={() => setCartOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.cartModal, { backgroundColor: palette.surface }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View><Text style={[styles.modalTitle, { color: palette.ink }]}>Your basket</Text><Text style={[styles.sectionSubtitle, { color: palette.muted }]}>{cartCount} item{cartCount === 1 ? "" : "s"}</Text></View>
              <Pressable onPress={() => setCartOpen(false)} style={[styles.closeButton, { backgroundColor: palette.surfaceSubtle }]}><X color={palette.ink} size={19} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.cartLines}>
              {cart.length ? cart.map((line) => (
                <View key={`${line.itemId}:${line.variantId ?? "base"}`} style={[styles.cartLine, { borderBottomColor: palette.border }]}>
                  <View style={styles.cartLineCopy}>
                    <Text style={[styles.cartItemName, { color: palette.ink }]}>{line.itemName}</Text>
                    {line.variantName ? <Text style={[styles.sectionSubtitle, { color: palette.muted }]}>{line.variantName}</Text> : null}
                    <Text style={[styles.cartItemPrice, { color: palette.ink }]}>{formatMoney(line.unitAmount, line.currencyCode)} each</Text>
                  </View>
                  <View style={styles.cartLineActions}>
                    <Pressable onPress={() => adjustCartLine(line.itemId, line.variantId, -1)} style={[styles.quantityButton, { borderColor: palette.border }]}><Minus color={palette.ink} size={14} /></Pressable>
                    <Text style={[styles.quantityValue, { color: palette.ink }]}>{line.quantity}</Text>
                    <Pressable onPress={() => adjustCartLine(line.itemId, line.variantId, 1)} style={[styles.quantityButton, { borderColor: palette.border }]}><Plus color={palette.ink} size={14} /></Pressable>
                    <Pressable onPress={() => setCart((current) => current.filter((candidate) => candidate.itemId !== line.itemId || candidate.variantId !== line.variantId))} style={styles.removeLine}><Trash2 color={palette.danger} size={16} /></Pressable>
                  </View>
                </View>
              )) : (
                <View style={styles.centerState}>
                  <ShoppingCart color={palette.muted} size={30} />
                  <Text style={[styles.emptyTitle, { color: palette.ink }]}>Your basket is empty</Text>
                  <Text style={[styles.emptyBody, { color: palette.muted }]}>Add products from the Store to start an order.</Text>
                </View>
              )}
            </ScrollView>
            {cart.length ? (
              <View style={[styles.checkoutFooter, { borderTopColor: palette.border }]}>
                <View style={styles.checkoutTotalRow}><Text style={[styles.sectionSubtitle, { color: palette.muted }]}>Subtotal</Text><Text style={[styles.checkoutTotal, { color: palette.ink }]}>{formatMoney(cartTotal, currencyCode)}</Text></View>
                <Text style={[styles.checkoutNote, { color: palette.muted }]}>The Store team will confirm availability and the next payment/fulfillment step after receiving your order request.</Text>
                <Pressable disabled={checkout.isPending || !cartReady} onPress={() => checkout.mutate()} style={[styles.primaryButton, styles.checkoutButton, { backgroundColor: palette.brand, opacity: checkout.isPending ? 0.65 : 1 }]}>
                  {checkout.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Submit order request</Text>}
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function CategoryChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { palette } = useAppTheme();
  return (
    <Pressable onPress={onPress} style={[styles.categoryChip, { backgroundColor: active ? palette.brand : palette.surface, borderColor: active ? palette.brand : palette.border }]}>
      <Text style={[styles.categoryChipText, { color: active ? "#FFFFFF" : palette.ink }]}>{label || "Category"}</Text>
    </Pressable>
  );
}

function chooseRecord(records: PlatformRecord[], variantId: string | null) {
  return records.find((record) => (record.variant_id ?? null) === variantId) ?? null;
}

function isEffective(record: PlatformRecord, now: number) {
  const from = typeof record.effective_from === "string" ? Date.parse(record.effective_from) : null;
  const until = typeof record.effective_until === "string" ? Date.parse(record.effective_until) : null;
  return (from === null || !Number.isFinite(from) || from <= now) &&
    (until === null || !Number.isFinite(until) || until > now);
}

function isInStock(record: PlatformRecord) {
  if (record.availability_status !== "available" || record.status !== "active") return false;
  const stock = optionalNumber(record.stock_quantity);
  return stock === null || stock - numberValue(record.reserved_quantity) > 0;
}

function remainingStock(record: PlatformRecord | null) {
  if (!record) return null;
  const stock = optionalNumber(record.stock_quantity);
  return stock === null ? null : Math.max(0, stock - numberValue(record.reserved_quantity));
}

function metadataValue(record: PlatformRecord, key: string): unknown {
  const metadata = record.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return (metadata as Record<string, unknown>)[key] ?? null;
}

function recordString(record: PlatformRecord | null | undefined, field: string) {
  const value = record?.[field];
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value: unknown) {
  const number = optionalNumber(value);
  return number !== null && number > 0 ? number : null;
}

function isCartLine(value: unknown): value is StoreCartLine {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const line = value as Record<string, unknown>;
  return typeof line.itemId === "string" &&
    (typeof line.variantId === "string" || line.variantId === null) &&
    typeof line.itemName === "string" &&
    typeof line.quantity === "number" && line.quantity > 0 &&
    typeof line.unitAmount === "number" && line.unitAmount >= 0 &&
    typeof line.currencyCode === "string";
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString()}`;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  backButton: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, gap: 1 },
  headerEyebrow: { fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  headerTitle: { fontSize: 24, lineHeight: 29, fontWeight: "900", letterSpacing: -0.6 },
  cartButton: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  cartCount: { position: "absolute", top: -4, right: -4, minWidth: 19, height: 19, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "#1A1A1D", borderWidth: 1.5, borderColor: "#FFFFFF" },
  cartCountText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 115, gap: 16 },
  hero: { minHeight: 146, borderRadius: 22, borderWidth: borders.hairline, padding: 18, flexDirection: "row", alignItems: "center", gap: 8 },
  heroCopy: { flex: 1, gap: 6 },
  heroEyebrow: { ...typography.eyebrow },
  heroTitle: { fontSize: 22, lineHeight: 26, fontWeight: "900", letterSpacing: -0.45 },
  heroBody: { fontSize: 12, lineHeight: 17, fontWeight: "500" },
  heroIcon: { width: 62, height: 62, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  searchBox: { minHeight: 50, borderRadius: 16, borderWidth: borders.control, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  searchInput: { flex: 1, fontSize: 14, fontWeight: "600", paddingVertical: 9 },
  categoryRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 8 },
  categoryChip: { minHeight: 37, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  categoryChipText: { fontSize: 11, fontWeight: "800" },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 18, fontWeight: "900" },
  sectionSubtitle: { fontSize: 11, lineHeight: 15, fontWeight: "600" },
  productGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 },
  productCard: { width: "48.5%", borderWidth: borders.hairline, borderRadius: 19, overflow: "hidden", padding: 9, gap: 8 },
  productImage: { position: "relative", width: "100%", aspectRatio: 1 },
  imagePlaceholder: { flex: 1, aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: radii.md },
  discountBadge: { position: "absolute", left: 7, top: 7, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 7 },
  discountText: { color: "#FFFFFF", fontSize: 8, fontWeight: "900" },
  productCopy: { gap: 5 },
  productCategory: { fontSize: 9, fontWeight: "700" },
  productName: { minHeight: 36, fontSize: 13, lineHeight: 17, fontWeight: "800" },
  productPriceRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  productPrice: { fontSize: 15, fontWeight: "900" },
  comparePrice: { fontSize: 10, textDecorationLine: "line-through", fontWeight: "600" },
  addButton: { minHeight: 36, borderRadius: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 4 },
  addButtonText: { fontSize: 10, fontWeight: "900" },
  emptyProducts: { minHeight: 170, alignItems: "center", justifyContent: "center", borderRadius: 18, borderWidth: borders.hairline, padding: 20, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "900", textAlign: "center" },
  emptyBody: { maxWidth: 320, fontSize: 12, lineHeight: 17, textAlign: "center" },
  centerState: { flex: 1, minHeight: 200, alignItems: "center", justifyContent: "center", padding: 28, gap: 10 },
  primaryButton: { minHeight: 48, borderRadius: 14, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  primaryButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  basketBar: { position: "absolute", left: 16, right: 16, bottom: 12, minHeight: 58, borderRadius: 19, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10, elevation: 6 },
  basketCount: { width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "rgba(255,255,255,.2)" },
  basketCountText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  basketText: { flex: 1, color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  basketTotal: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,.52)" },
  productModal: { maxHeight: "88%", borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 18, gap: 13 },
  cartModal: { height: "84%", borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 18, gap: 13 },
  modalHandle: { width: 42, height: 4, borderRadius: 3, backgroundColor: "#A5A5AB", alignSelf: "center", marginBottom: 2 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  modalTitle: { flex: 1, fontSize: 19, fontWeight: "900" },
  closeButton: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  modalDescription: { fontSize: 12, lineHeight: 17 },
  optionSection: { gap: 8 },
  optionLabel: { fontSize: 13, fontWeight: "900" },
  optionList: { gap: 7 },
  optionButton: { minHeight: 49, borderWidth: 1.3, borderRadius: 13, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 9 },
  optionRadio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: "#AAAAB0", alignItems: "center", justifyContent: "center" },
  optionName: { flex: 1, fontSize: 12, fontWeight: "800" },
  optionPrice: { fontSize: 12, fontWeight: "900" },
  modalFooter: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 5 },
  quantityPicker: { flexDirection: "row", alignItems: "center", gap: 8 },
  quantityButton: { width: 34, height: 34, borderRadius: 11, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  quantityValue: { minWidth: 18, textAlign: "center", fontSize: 13, fontWeight: "900" },
  cartLines: { paddingBottom: 10, flexGrow: 1 },
  cartLine: { paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 8 },
  cartLineCopy: { flex: 1, gap: 3 },
  cartItemName: { fontSize: 13, fontWeight: "800" },
  cartItemPrice: { fontSize: 11, fontWeight: "700" },
  cartLineActions: { flexDirection: "row", alignItems: "center", gap: 5 },
  removeLine: { padding: 5 },
  checkoutFooter: { paddingTop: 13, borderTopWidth: StyleSheet.hairlineWidth, gap: 9 },
  checkoutTotalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  checkoutTotal: { fontSize: 20, fontWeight: "900" },
  checkoutNote: { fontSize: 10, lineHeight: 15 },
  checkoutButton: { width: "100%" },
});
