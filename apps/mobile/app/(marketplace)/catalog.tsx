import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, SafeAreaView, TouchableOpacity, Alert } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../../../../src/design-system/theme';
import { AppButton } from '../../../../src/components/buttons/AppButton';
import { AppInput } from '../../../../src/components/inputs/AppInput';
import { BaseCard } from '../../../../src/components/cards/BaseCard';
import { formatCurrency } from '../../../../src/utils';

import { MarketplaceEngine, ProductItem } from '../../../../src/services/MarketplaceEngine';

export default function MarketplaceCatalogScreen() {
  const [searchQuery, setSearchQuery] = useState('');

  const products: ProductItem[] = [
    {
      id: 'PRD-8901',
      merchantId: 'merch-1',
      merchantName: 'Awka Gas Accessories Store',
      title: 'Heavy Duty LPG Hose & Regulator Kit',
      description: 'High pressure safety LPG hose with auto shutoff valve',
      price: 8500.0,
      currency: 'NGN',
      stockQuantity: 14,
      category: 'LPG_ACCESSORIES',
      status: 'ACTIVE',
      imageUrls: [],
    },
    {
      id: 'PRD-8902',
      merchantId: 'merch-2',
      merchantName: 'Standard Commerce Ltd',
      title: 'Digital Gas Cylinder Scale (Max 50kg)',
      description: 'Precision digital weight scale for LPG cylinders',
      price: 12000.0,
      currency: 'NGN',
      stockQuantity: 8,
      category: 'SAFETY_GEAR',
      status: 'ACTIVE',
      imageUrls: [],
    },
    {
      id: 'PRD-8903',
      merchantId: 'merch-3',
      merchantName: 'Awka Safety Solutions',
      title: 'Automatic Gas Leakage Detector Alarm',
      description: 'Smart sensor alarm for cooking gas leakages',
      price: 15500.0,
      currency: 'NGN',
      stockQuantity: 20,
      category: 'SAFETY_GEAR',
      status: 'ACTIVE',
      imageUrls: [],
    },
  ];

  const handleBuyNow = (product: ProductItem) => {
    const stockValidation = MarketplaceEngine.validateStockAvailability([{ product, quantity: 1 }]);
    if (!stockValidation.valid) {
      Alert.alert('Out of Stock', stockValidation.errorMessage);
      return;
    }

    const quote = MarketplaceEngine.quoteMarketplaceOrder([{ product, quantity: 1 }]);

    Alert.alert(
      'Escrow Purchase Confirmed',
      `Purchased "${product.title}" for ${formatCurrency(quote.totalAmount)} (inc. ${formatCurrency(quote.deliveryFee)} delivery). Funds locked in Skima Escrow until delivery is verified.`,
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        
        <Text style={styles.title}>Skima Marketplace</Text>
        <Text style={styles.subtitle}>Verified Merchants • Escrow Protected Delivery</Text>

        <AppInput
          placeholder="Search products, gas accessories, cookers..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />

        <Text style={styles.sectionTitle}>Featured Products</Text>

        {products.map(item => (
          <BaseCard key={item.id} title={item.title} badge="VERIFIED MERCHANT" badgeColor={Colors.accentGreen}>
            <View style={styles.row}>
              <Text style={styles.key}>Merchant:</Text>
              <Text style={styles.val}>{item.merchantName}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.key}>Stock Available:</Text>
              <Text style={styles.val}>{item.stockQuantity} units</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.key}>Price:</Text>
              <Text style={[styles.val, { color: Colors.accentFlame, fontSize: 16 }]}>{formatCurrency(item.price)}</Text>
            </View>

            <AppButton
              title={`Buy Now via Escrow (${formatCurrency(item.price)})`}
              onPress={() => handleBuyNow(item)}
              variant="primary"
              style={{ marginTop: Spacing.sm }}
            />
          </BaseCard>
        ))}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDark },
  content: { padding: Spacing.md },
  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: 'bold', marginBottom: 2 },
  subtitle: { color: Colors.textMuted, fontSize: 13, marginBottom: Spacing.md },
  sectionTitle: { color: Colors.textPrimary, fontSize: 16, fontWeight: 'bold', marginVertical: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 4 },
  key: { color: Colors.textMuted, fontSize: 13 },
  val: { color: Colors.textPrimary, fontSize: 13, fontWeight: 'bold' },
});
