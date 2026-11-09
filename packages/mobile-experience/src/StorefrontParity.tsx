import type { ReactNode } from "react";
import { ArrowLeft, Minus, Plus, ShoppingCart } from "lucide-react-native";
import { Modal, Pressable, ScrollView, Text, View, type DimensionValue } from "react-native";

export type StorefrontPalette = {
  brand: string;
  brandSoft: string;
  surface: string;
  surfaceSubtle: string;
  border: string;
  ink: string;
  muted: string;
  success: string;
};

export function StorefrontHero({
  palette,
  walletValue,
  basketCount,
  basketSubtotal,
  onBasketPress,
  disabled = false,
}: {
  palette: StorefrontPalette;
  walletValue: string;
  basketCount: number;
  basketSubtotal: string;
  onBasketPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={{ backgroundColor: palette.brand, borderColor: palette.brand, borderWidth: 1, borderRadius: 20, padding: 18, gap: 10 }}>
      <Text style={{ fontSize: 9, color: "rgba(255,255,255,.76)", fontWeight: "900", letterSpacing: 1.5 }}>SKIMA STORE</Text>
      <Text style={{ fontSize: 26, color: "#fff", fontWeight: "900", letterSpacing: -.5 }}>Good finds. Easy days.</Text>
      <Text style={{ fontSize: 11, color: "rgba(255,255,255,.88)", lineHeight: 17 }}>Browse products from participating sellers and shop everyday essentials, all in one place.</Text>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 5 }}>
        <View style={{ gap: 2, flex: 1 }}>
          <Text style={{ fontSize: 9, color: "rgba(255,255,255,.72)", fontWeight: "800" }}>YOUR SKIMA WALLET</Text>
          <Text style={{ fontSize: 15, color: "#fff", fontWeight: "900" }}>{walletValue}</Text>
        </View>
        {onBasketPress ? (
          <Pressable accessibilityRole="button" accessibilityLabel={basketCount ? "View basket, " + basketCount + " items" : "Basket empty"} onPress={onBasketPress} disabled={disabled} style={{ backgroundColor: "#fff", borderRadius: 15, paddingHorizontal: 13, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 8, opacity: disabled ? .55 : 1 }}>
            <ShoppingCart size={16} color={palette.brand} />
            <View>
              <Text style={{ color: palette.brand, fontSize: 10, fontWeight: "900" }}>{basketCount ? "View basket · " + basketCount : "Basket empty"}</Text>
              {basketCount ? <Text style={{ color: palette.brand, fontSize: 9, fontWeight: "700" }}>{basketSubtotal}</Text> : null}
            </View>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function StorefrontProductCard({
  palette,
  width = "48.5%",
  media,
  categoryLabel,
  name,
  variantName,
  priceLabel,
  compareAtLabel,
  stockLabel,
  onAdd,
  onDetails,
  addDisabled = false,
  addLabel = "Add to basket",
}: {
  palette: StorefrontPalette;
  width?: DimensionValue;
  media: ReactNode;
  categoryLabel: string;
  name: string;
  variantName?: string | null;
  priceLabel: string;
  compareAtLabel?: string | null;
  stockLabel: string;
  onAdd(): void;
  onDetails?: () => void;
  addDisabled?: boolean;
  addLabel?: string;
}) {
  return (
    <View style={{ width, borderWidth: 1, borderColor: palette.border, borderRadius: 17, padding: 9, gap: 6, backgroundColor: palette.surface }}>
      <Pressable disabled={!onDetails} onPress={onDetails} accessibilityRole={onDetails ? "button" : undefined}>
        <View style={{ height: 110, borderRadius: 12, overflow: "hidden", backgroundColor: palette.surfaceSubtle }}>{media}</View>
        <Text style={{ color: palette.muted, fontSize: 9, fontWeight: "700", marginTop: 6 }} numberOfLines={1}>{categoryLabel}</Text>
        <Text style={{ color: palette.ink, fontSize: 11, fontWeight: "900", lineHeight: 16, minHeight: 32 }} numberOfLines={2}>{name}</Text>
      </Pressable>
      {variantName ? <Text style={{ color: palette.muted, fontSize: 9 }} numberOfLines={1}>{variantName}</Text> : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <Text style={{ fontSize: 12, color: palette.ink, fontWeight: "900" }}>{priceLabel}</Text>
        {compareAtLabel ? <Text style={{ fontSize: 9, color: palette.muted, textDecorationLine: "line-through" }}>{compareAtLabel}</Text> : null}
      </View>
      <Text style={{ fontSize: 9, color: palette.success, fontWeight: "800" }}>{stockLabel}</Text>
      <Pressable accessibilityRole="button" onPress={onAdd} disabled={addDisabled} style={{ minHeight: 34, borderRadius: 11, backgroundColor: palette.brand, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, opacity: addDisabled ? .5 : 1, marginTop: 2 }}>
        <Plus size={14} color="#fff" />
        <Text style={{ color: "#fff", fontSize: 10, fontWeight: "900" }}>{addLabel}</Text>
      </Pressable>
    </View>
  );
}

export function StorefrontBasketLine({
  palette,
  name,
  variantName,
  quantity,
  amountLabel,
  onDecrease,
  onIncrease,
  increaseDisabled = false,
}: {
  palette: StorefrontPalette;
  name: string;
  variantName?: string | null;
  quantity: number;
  amountLabel: string;
  onDecrease(): void;
  onIncrease(): void;
  increaseDisabled?: boolean;
}) {
  return (
    <View style={{ minHeight: 68, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: .5, borderBottomColor: palette.border, paddingVertical: 7 }}>
      <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: palette.surfaceSubtle, alignItems: "center", justifyContent: "center" }}><ShoppingCart size={17} color={palette.brand} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={{ color: palette.ink, fontSize: 11, fontWeight: "900" }} numberOfLines={2}>{name}</Text>
        {variantName ? <Text style={{ color: palette.muted, fontSize: 9 }} numberOfLines={1}>{variantName}</Text> : null}
        <Text style={{ color: palette.ink, fontSize: 11, fontWeight: "800" }}>{amountLabel}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 12, backgroundColor: palette.surfaceSubtle, paddingHorizontal: 5, paddingVertical: 4 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={"Decrease " + name} onPress={onDecrease} style={{ width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" }}><Minus size={13} color={palette.ink} /></Pressable>
        <Text style={{ fontSize: 11, color: palette.ink, fontWeight: "900", minWidth: 14, textAlign: "center" }}>{quantity}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={"Increase " + name} disabled={increaseDisabled} onPress={onIncrease} style={{ width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center", opacity: increaseDisabled ? .4 : 1 }}><Plus size={13} color={palette.brand} /></Pressable>
      </View>
    </View>
  );
}

export function StorefrontCategoryChip({
  palette,
  label,
  active,
  onPress,
}: {
  palette: StorefrontPalette;
  label: string;
  active: boolean;
  onPress(): void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={{ borderRadius: 13, borderWidth: 1, borderColor: active ? palette.brand : palette.border, backgroundColor: active ? palette.brandSoft : palette.surface, paddingHorizontal: 13, paddingVertical: 9 }}>
      <Text style={{ fontSize: 10, fontWeight: "900", color: active ? palette.brand : palette.ink }}>{label}</Text>
    </Pressable>
  );
}

export function StorefrontDetailSheet({
  visible,
  onClose,
  palette,
  title,
  media,
  categoryLabel,
  description,
  priceLabel,
  compareAtLabel,
  stockLabel,
  children,
  footer,
}: {
  visible: boolean;
  onClose(): void;
  palette: StorefrontPalette;
  title: string;
  media?: ReactNode;
  categoryLabel?: string;
  description?: string | null;
  priceLabel?: string | null;
  compareAtLabel?: string | null;
  stockLabel?: string | null;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,.48)", justifyContent: "flex-end" }}>
        <View style={{ maxHeight: "90%", backgroundColor: palette.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to Store" onPress={onClose} style={{ minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingRight: 4 }}>
              <ArrowLeft size={17} color={palette.brand} />
              <Text style={{ color: palette.brand, fontWeight: "900", fontSize: 11 }}>Back to Store</Text>
            </Pressable>
            <Text style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: "900", color: palette.ink, textAlign: "right" }} numberOfLines={2}>{title}</Text>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 12 }}>
            {media ? <View style={{ height: 190, borderRadius: 16, overflow: "hidden", backgroundColor: palette.surfaceSubtle }}>{media}</View> : null}
            {categoryLabel ? <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "700" }}>{categoryLabel}</Text> : null}
            {description ? <Text style={{ color: palette.ink, fontSize: 12, lineHeight: 19 }}>{description}</Text> : null}
            {priceLabel ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ fontSize: 17, fontWeight: "900", color: palette.ink }}>{priceLabel}</Text>
                {compareAtLabel ? <Text style={{ fontSize: 11, color: palette.muted, textDecorationLine: "line-through" }}>{compareAtLabel}</Text> : null}
              </View>
            ) : null}
            {stockLabel ? <Text style={{ fontSize: 10, color: palette.success, fontWeight: "800" }}>{stockLabel}</Text> : null}
            {children}
          </ScrollView>
          {footer ? <View style={{ borderTopWidth: .5, borderTopColor: palette.border, paddingTop: 10 }}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}
