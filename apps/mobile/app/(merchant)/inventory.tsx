import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, SafeAreaView, Alert } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../../../../src/design-system/theme';
import { BaseCard } from '../../../../src/components/cards/BaseCard';
import { AppButton } from '../../../../src/components/buttons/AppButton';
import { AppInput } from '../../../../src/components/inputs/AppInput';
import { formatCurrency } from '../../../../src/utils';

import { MerchantAssistantAgent } from '../../../../src/services/ai/MerchantAssistantAgent';

export default function MerchantInventoryScreen() {
  const [productName, setProductName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [salesBalance, setSalesBalance] = useState(128500.0);
  const [aiEnhancing, setAiEnhancing] = useState(false);

  const inventoryItems = [
    { id: 'INV-1', title: 'Heavy Duty LPG Hose & Regulator Kit', price: 8500.0, stock: 14 },
    { id: 'INV-2', title: 'Automatic Gas Leakage Detector Alarm', price: 15500.0, stock: 20 },
  ];

  const handleAiEnhance = () => {
    if (!productName.trim()) {
      Alert.alert('Enter Product Name', 'Please type a basic product name to enhance with Gemini AI.');
      return;
    }
    setAiEnhancing(true);
    setTimeout(() => {
      setAiEnhancing(false);
      const enhanced = MerchantAssistantAgent.enhanceProductListing(productName, 'LPG Accessories');
      setProductName(enhanced.title);
      setDescription(enhanced.description);
      Alert.alert('AI Enhanced', `Generated professional title & description for "${enhanced.title}".`);
    }, 600);
  };

  const handleAddProduct = () => {
    if (!productName || !price || !stock) {
      Alert.alert('Missing Info', 'Please provide product title, price, and stock count.');
      return;
    }
    Alert.alert('Product Published', `"${productName}" added to Skima Marketplace catalog.`);
    setProductName('');
    setDescription('');
    setPrice('');
    setStock('');
  };

  const handleWithdrawSales = () => {
    Alert.alert(
      'Merchant Settlement Requested',
      `${formatCurrency(salesBalance)} requested for bank withdrawal via Payment Gateway Adapter.`,
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        
        <Text style={styles.title}>Merchant Store Console</Text>
        <Text style={styles.subtitle}>Awka Gas Accessories Store • Escrow Settlement Account</Text>

        {/* MERCHANT SALES SUMMARY */}
        <BaseCard title="Merchant Revenue Balance" badge="SETTLEMENT READY" badgeColor={Colors.accentGreen}>
          <Text style={styles.balanceText}>{formatCurrency(salesBalance)}</Text>
          <AppButton
            title="Request Bank Withdrawal"
            onPress={handleWithdrawSales}
            variant="secondary"
            style={{ marginTop: Spacing.sm }}
          />
        </BaseCard>

        {/* ADD NEW PRODUCT FORM */}
        <BaseCard title="Publish Product to Skima Marketplace" badge="AI POWERED" badgeColor={Colors.accentTeal}>
          <AppInput
            label="Product Title"
            placeholder="e.g. Dual-Burner Gas Stove"
            value={productName}
            onChangeText={setProductName}
          />

          <AppButton
            title={aiEnhancing ? 'Enhancing with Gemini AI...' : '✨ Enhance Title & Description (AI Agent 3)'}
            onPress={handleAiEnhance}
            variant="secondary"
            loading={aiEnhancing}
            style={{ marginBottom: Spacing.md }}
          />

          {description ? (
            <View style={{ backgroundColor: 'rgba(6,182,212,0.1)', padding: 10, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(6,182,212,0.3)' }}>
              <Text style={{ color: Colors.accentTeal, fontSize: 11, fontWeight: '700' }}>AI Description:</Text>
              <Text style={{ color: Colors.textPrimary, fontSize: 13, marginTop: 2 }}>{description}</Text>
            </View>
          ) : null}

          <AppInput
            label="Selling Price (NGN)"
            placeholder="e.g. 18500"
            value={price}
            onChangeText={setPrice}
            keyboardType="decimal-pad"
          />

          <AppInput
            label="Initial Stock Quantity"
            placeholder="e.g. 10"
            value={stock}
            onChangeText={setStock}
            keyboardType="numeric"
          />

          <AppButton
            title="Publish to Marketplace Catalog"
            onPress={handleAddProduct}
            variant="primary"
          />
        </BaseCard>

        {/* INVENTORY LIST */}
        <Text style={styles.sectionTitle}>Current Store Inventory ({inventoryItems.length})</Text>
        {inventoryItems.map(item => (
          <BaseCard key={item.id} title={item.title}>
            <View style={styles.row}>
              <Text style={styles.key}>Price:</Text>
              <Text style={[styles.val, { color: Colors.accentFlame }]}>{formatCurrency(item.price)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.key}>Stock Available:</Text>
              <Text style={styles.val}>{item.stock} units</Text>
            </View>
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
  balanceText: { color: Colors.textPrimary, fontSize: 28, fontWeight: 'bold', marginVertical: 4 },
  sectionTitle: { color: Colors.textPrimary, fontSize: 16, fontWeight: 'bold', marginVertical: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 4 },
  key: { color: Colors.textMuted, fontSize: 13 },
  val: { color: Colors.textPrimary, fontSize: 13, fontWeight: 'bold' },
});
