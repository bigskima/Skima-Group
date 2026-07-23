import React, { useState } from 'react';
import { Alert, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Colors, Radius, Spacing } from '../../../../src/design-system/theme';
import { AppButton } from '../../../../src/components/buttons/AppButton';
import { BaseCard } from '../../../../src/components/cards/BaseCard';
import { Badge } from '../../../../src/components/common/Badge';
import { MarketplaceEngine, ProductItem } from '../../../../src/services/MarketplaceEngine';
import { formatCurrency } from '../../../../src/utils';

export default function ProductDetailScreen() {
  const [quantity, setQuantity] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);

  const product: ProductItem = {
    id: 'PRD-8901',
    merchantId: 'merch-1',
    merchantName: 'Awka Gas Accessories Store',
    title: 'Heavy Duty LPG Hose & Regulator Kit',
    description: 'Certified high-pressure 2.5m rubber LPG hose with brass auto-shutoff regulator valve and steel safety clamps. Manufactured to ISO 9001 safety standards for domestic cooking gas cylinders.',
    price: 8500.0,
    currency: 'NGN',
    stockQuantity: 14,
    category: 'LPG_ACCESSORIES',
    status: 'ACTIVE',
    imageUrls: [],
  };

  const deliveryFee = 1000.0;
  const quote = MarketplaceEngine.quoteMarketplaceOrder([{ product, quantity }], deliveryFee);

  const handleBuyNow = () => {
    const stockValidation = MarketplaceEngine.validateStockAvailability([{ product, quantity }]);
    if (!stockValidation.valid) {
      Alert.alert('Out of Stock', stockValidation.errorMessage);
      return;
    }

    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      Alert.alert(
        'Escrow Order Confirmed',
        `Purchased ${quantity}x "${product.title}" for ${formatCurrency(quote.totalAmount)} (${formatCurrency(quote.subtotal)} + ${formatCurrency(deliveryFee)} delivery).\nFunds locked in Skima Escrow.`,
      );
    }, 800);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        
        {/* PRODUCT GALLERY PLACEHOLDER */}
        <View style={styles.imagePlaceholder}>
          <Text style={styles.imageIcon}>🧯</Text>
          <Badge label="VERIFIED MERCHANT PRODUCT" variant="success" />
        </View>

        {/* TITLE & MERCHANT INFO */}
        <Text style={styles.title}>{product.title}</Text>
        <Text style={styles.merchantText}>Sold by {product.merchantName}</Text>
        <Text style={styles.priceText}>{formatCurrency(product.price)}</Text>

        {/* DESCRIPTION */}
        <BaseCard title="Product Specifications & Safety">
          <Text style={styles.descText}>{product.description}</Text>
          <View style={styles.row}>
            <Text style={styles.key}>Stock Available:</Text>
            <Text style={styles.val}>{product.stockQuantity} units in Awka warehouse</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.key}>Escrow Protection:</Text>
            <Text style={[styles.val, { color: Colors.accentGreen }]}>100% Refund Guarantee</Text>
          </View>
        </BaseCard>

        {/* QUANTITY SELECTOR */}
        <BaseCard title="Order Quantity">
          <View style={styles.qtyRow}>
            <AppButton
              title="-"
              onPress={() => setQuantity((q) => Math.max(1, q - 1))}
              variant="secondary"
              style={{ width: 44 }}
            />
            <Text style={styles.qtyText}>{quantity}</Text>
            <AppButton
              title="+"
              onPress={() => setQuantity((q) => Math.min(product.stockQuantity, q + 1))}
              variant="secondary"
              style={{ width: 44 }}
            />
          </View>
        </BaseCard>

        {/* PRICE SUMMARY */}
        <BaseCard title="Payment Summary">
          <View style={styles.row}>
            <Text style={styles.key}>Subtotal ({quantity} item):</Text>
            <Text style={styles.val}>{formatCurrency(quote.subtotal)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.key}>Delivery Fee (Awka Area):</Text>
            <Text style={styles.val}>{formatCurrency(deliveryFee)}</Text>
          </View>
          <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalKey}>Total Escrow Amount:</Text>
            <Text style={styles.totalVal}>{formatCurrency(quote.totalAmount)}</Text>
          </View>
        </BaseCard>

        <AppButton
          title={`Lock ${formatCurrency(quote.totalAmount)} & Purchase`}
          onPress={handleBuyNow}
          loading={loading}
          variant="primary"
        />

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDark },
  content: { padding: Spacing.md },
  imagePlaceholder: {
    height: 180,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.bgCardBorder,
    marginBottom: Spacing.md,
  },
  imageIcon: { fontSize: 54, marginBottom: Spacing.xs },
  title: { color: Colors.textPrimary, fontSize: 22, fontWeight: 'bold', marginBottom: 2 },
  merchantText: { color: Colors.accentTeal, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  priceText: { color: Colors.accentFlame, fontSize: 26, fontWeight: '900', marginBottom: Spacing.md },
  descText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 4 },
  key: { color: Colors.textMuted, fontSize: 13 },
  val: { color: Colors.textPrimary, fontSize: 13, fontWeight: 'bold' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  qtyText: { color: Colors.textPrimary, fontSize: 20, fontWeight: 'bold' },
  totalRow: { borderTopWidth: 1, borderTopColor: Colors.bgCardBorder, paddingTop: Spacing.sm, marginTop: Spacing.xs },
  totalKey: { color: Colors.textPrimary, fontSize: 15, fontWeight: 'bold' },
  totalVal: { color: Colors.accentFlame, fontSize: 20, fontWeight: 'bold' },
});
