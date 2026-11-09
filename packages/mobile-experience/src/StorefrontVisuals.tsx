import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Minus, Plus, X } from "lucide-react-native";

export type StorefrontPalette = {
  surface: string;
  surfaceSubtle: string;
  ink: string;
  muted: string;
  border: string;
  brand: string;
  brandSoft: string;
  success?: string;
  danger?: string;
};

export function StorefrontProductCard({
  palette,
  width = "48.5%",
  media,
  category,
  title,
  subtitle,
  price,
  compareAtPrice,
  stockLabel,
  addLabel = "Add to basket",
  disabled = false,
  onOpen,
  onAdd,
}: {
  palette: StorefrontPalette;
  width?: number | string;
  media: ReactNode;
  category?: string | null;
  title: string;
  subtitle?: string | null;
  price: string;
  compareAtPrice?: string | null;
  stockLabel?: string | null;
  addLabel?: string;
  disabled?: boolean;
  onOpen(): void;
  onAdd(): void;
}) {
  return (
    <View style={[styles.productCard, { width, backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Pressable accessibilityRole="button" onPress={onOpen} style={styles.mediaPressable}>
        <View style={[styles.productMedia, { backgroundColor: palette.surfaceSubtle }]}>{media}</View>
      </Pressable>
      <View style={styles.productCopy}>
        {category ? <Text numberOfLines={1} style={[styles.category, { color: palette.muted }]}>{category}</Text> : null}
        <Pressable accessibilityRole="button" onPress={onOpen}>
          <Text numberOfLines={2} style={[styles.productName, { color: palette.ink }]}>{title}</Text>
        </Pressable>
        {subtitle ? <Text numberOfLines={1} style={[styles.subtitle, { color: palette.muted }]}>{subtitle}</Text> : null}
        <View style={styles.priceRow}>
          <Text style={[styles.price, { color: palette.ink }]}>{price}</Text>
          {compareAtPrice ? <Text style={[styles.comparePrice, { color: palette.muted }]}>{compareAtPrice}</Text> : null}
        </View>
        {stockLabel ? <Text style={[styles.stock, { color: palette.success ?? palette.brand }]}>{stockLabel}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={onAdd}
          style={({ pressed }) => [
            styles.addButton,
            { backgroundColor: palette.brandSoft, opacity: disabled ? 0.45 : pressed ? 0.72 : 1 },
          ]}
        >
          <Plus size={15} color={palette.brand} />
          <Text style={[styles.addButtonText, { color: palette.brand }]}>{addLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function StorefrontProductDetailsSheet({
  visible,
  palette,
  title,
  category,
  description,
  price,
  compareAtPrice,
  stockLabel,
  media,
  children,
  quantity,
  maxQuantity = 99,
  addLabel = "Add to basket",
  disabled = false,
  onQuantityChange,
  onClose,
  onAdd,
}: {
  visible: boolean;
  palette: StorefrontPalette;
  title: string;
  category?: string | null;
  description?: string | null;
  price: string;
  compareAtPrice?: string | null;
  stockLabel?: string | null;
  media?: ReactNode;
  children?: ReactNode;
  quantity: number;
  maxQuantity?: number;
  addLabel?: string;
  disabled?: boolean;
  onQuantityChange(value: number): void;
  onClose(): void;
  onAdd(): void;
}) {
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: palette.surface }]}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleBlock}>
              {category ? <Text style={[styles.category, { color: palette.brand }]}>{category}</Text> : null}
              <Text style={[styles.sheetTitle, { color: palette.ink }]} numberOfLines={2}>{title}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close product details" onPress={onClose} style={[styles.closeButton, { backgroundColor: palette.surfaceSubtle }]}>
              <X color={palette.ink} size={19} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetContent}>
            {media ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gallery}>{media}</ScrollView> : null}
            {description ? <Text style={[styles.description, { color: palette.muted }]}>{description}</Text> : null}
            <View style={styles.priceRow}>
              <Text style={[styles.detailPrice, { color: palette.ink }]}>{price}</Text>
              {compareAtPrice ? <Text style={[styles.comparePrice, { color: palette.muted }]}>{compareAtPrice}</Text> : null}
            </View>
            {stockLabel ? <Text style={[styles.stock, { color: palette.success ?? palette.brand }]}>{stockLabel}</Text> : null}
            {children}
          </ScrollView>
          <View style={[styles.sheetFooter, { borderTopColor: palette.border }]}>
            <View style={styles.quantityControl}>
              <Pressable accessibilityRole="button" accessibilityLabel="Decrease quantity" disabled={quantity <= 1} onPress={() => onQuantityChange(Math.max(1, quantity - 1))} style={[styles.quantityButton, { borderColor: palette.border, opacity: quantity <= 1 ? 0.4 : 1 }]}>
                <Minus size={16} color={palette.ink} />
              </Pressable>
              <Text style={[styles.quantityValue, { color: palette.ink }]}>{quantity}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Increase quantity" disabled={quantity >= maxQuantity || disabled} onPress={() => onQuantityChange(Math.min(maxQuantity, quantity + 1))} style={[styles.quantityButton, { borderColor: palette.border, opacity: quantity >= maxQuantity || disabled ? 0.4 : 1 }]}>
                <Plus size={16} color={palette.ink} />
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={disabled || maxQuantity < 1}
              onPress={onAdd}
              style={({ pressed }) => [styles.primaryButton, { backgroundColor: palette.brand, opacity: disabled || maxQuantity < 1 ? 0.45 : pressed ? 0.8 : 1 }]}
            >
              <Text style={styles.primaryButtonText}>{addLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function StorefrontBasketRow({
  palette,
  title,
  subtitle,
  quantity,
  total,
  image,
  disabled = false,
  onDecrease,
  onIncrease,
  onRemove,
}: {
  palette: StorefrontPalette;
  title: string;
  subtitle?: string | null;
  quantity: number;
  total: string;
  image?: ReactNode;
  disabled?: boolean;
  onDecrease(): void;
  onIncrease(): void;
  onRemove?: () => void;
}) {
  return (
    <View style={[styles.basketRow, { borderBottomColor: palette.border }]}>
      <View style={[styles.basketImage, { backgroundColor: palette.surfaceSubtle }]}>{image}</View>
      <View style={styles.basketCopy}>
        <Text numberOfLines={2} style={[styles.basketTitle, { color: palette.ink }]}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} style={[styles.subtitle, { color: palette.muted }]}>{subtitle}</Text> : null}
        <Text style={[styles.basketTotal, { color: palette.ink }]}>{total}</Text>
      </View>
      <View style={styles.quantityControl}>
        <Pressable accessibilityRole="button" accessibilityLabel="Decrease quantity" disabled={disabled} onPress={onDecrease} style={[styles.quantityButton, { borderColor: palette.border }]}>
          <Minus size={14} color={palette.ink} />
        </Pressable>
        <Text style={[styles.quantityValue, { color: palette.ink }]}>{quantity}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Increase quantity" disabled={disabled} onPress={onIncrease} style={[styles.quantityButton, { borderColor: palette.border }]}>
          <Plus size={14} color={palette.brand} />
        </Pressable>
      </View>
      {onRemove ? <Pressable accessibilityRole="button" accessibilityLabel="Remove item" disabled={disabled} onPress={onRemove} style={styles.removeButton}><X size={15} color={palette.danger ?? palette.muted} /></Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  productCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 17, padding: 9, gap: 7 },
  mediaPressable: { overflow: "hidden", borderRadius: 12 },
  productMedia: { height: 116, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  productCopy: { gap: 6 },
  category: { fontSize: 9, fontWeight: "800", letterSpacing: 0.2 },
  productName: { fontSize: 12, lineHeight: 17, fontWeight: "900" },
  subtitle: { fontSize: 9, lineHeight: 13, fontWeight: "600" },
  priceRow: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 7 },
  price: { fontSize: 13, fontWeight: "900" },
  comparePrice: { fontSize: 9, textDecorationLine: "line-through" },
  stock: { fontSize: 9, fontWeight: "800" },
  addButton: { minHeight: 36, borderRadius: 11, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  addButtonText: { fontSize: 10, fontWeight: "900" },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,.52)" },
  sheet: { maxHeight: "88%", borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 18, gap: 13 },
  handle: { width: 42, height: 4, borderRadius: 3, backgroundColor: "#A5A5AB", alignSelf: "center" },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  sheetTitleBlock: { flex: 1, minWidth: 0, gap: 3 },
  sheetTitle: { fontSize: 19, lineHeight: 24, fontWeight: "900" },
  closeButton: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sheetContent: { gap: 12, paddingBottom: 5 },
  gallery: { gap: 9, paddingVertical: 2 },
  description: { fontSize: 12, lineHeight: 18 },
  detailPrice: { fontSize: 17, fontWeight: "900" },
  sheetFooter: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  quantityControl: { flexDirection: "row", alignItems: "center", gap: 9 },
  quantityButton: { width: 34, height: 34, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  quantityValue: { minWidth: 18, textAlign: "center", fontSize: 13, fontWeight: "900" },
  primaryButton: { minHeight: 43, flex: 1, borderRadius: 13, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  basketRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 9 },
  basketImage: { width: 48, height: 48, borderRadius: 13, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  basketCopy: { flex: 1, minWidth: 0, gap: 3 },
  basketTitle: { fontSize: 11, fontWeight: "900" },
  basketTotal: { fontSize: 11, fontWeight: "800" },
  removeButton: { width: 28, height: 32, alignItems: "center", justifyContent: "center" },
});
