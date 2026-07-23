import React, { useState } from 'react';
import { Alert, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Colors, Radius, Spacing } from '../../../../src/design-system/theme';
import { AppButton } from '../../../../src/components/buttons/AppButton';
import { AppInput } from '../../../../src/components/inputs/AppInput';
import { BaseCard } from '../../../../src/components/cards/BaseCard';
import { Badge } from '../../../../src/components/common/Badge';
import { formatCurrency } from '../../../../src/utils';

export default function StationStockManagementScreen() {
  const [stockKg, setStockKg] = useState<number>(850.0);
  const [addStockInput, setAddStockInput] = useState<string>('500');
  const [pricePerKg, setPricePerKg] = useState<number>(1400.0);

  const attendants = [
    { id: 'att-1', name: 'Sunday M.', role: 'PUMP_ATTENDANT', status: 'ACTIVE' },
    { id: 'att-2', name: 'Emeka A.', role: 'PUMP_ATTENDANT', status: 'ACTIVE' },
  ];

  const handleAddStock = () => {
    const qty = parseFloat(addStockInput) || 0;
    if (qty <= 0) {
      Alert.alert('Invalid Stock', 'Please enter a valid weight in kg to add.');
      return;
    }
    setStockKg((prev) => prev + qty);
    setAddStockInput('');
    Alert.alert('Stock Updated', `Added ${qty}kg to station inventory. Total stock: ${stockKg + qty}kg.`);
  };

  const handleTogglePrice = () => {
    const newPrice = pricePerKg === 1400 ? 1450 : 1400;
    setPricePerKg(newPrice);
    Alert.alert('Station Price Updated', `LPG Gas price set to ${formatCurrency(newPrice)} per kg.`);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Station Inventory & Pricing</Text>
        <Text style={styles.subtitle}>Awka Central LPG Plant • Station Admin Operations</Text>

        {/* INVENTORY & PRICE CARDS */}
        <View style={styles.grid}>
          <BaseCard style={{ flex: 1, marginRight: Spacing.xs }}>
            <Text style={styles.label}>Available Stock</Text>
            <Text style={styles.val}>{stockKg} kg</Text>
          </BaseCard>

          <BaseCard style={{ flex: 1, marginLeft: Spacing.xs }}>
            <Text style={styles.label}>Price per KG</Text>
            <Text style={[styles.val, { color: Colors.accentFlame }]}>{formatCurrency(pricePerKg)}</Text>
          </BaseCard>
        </View>

        {/* REPLENISH STOCK FORM */}
        <BaseCard title="Replenish Gas Stock Inventory">
          <AppInput
            label="Additional Gas Quantity (kg)"
            value={addStockInput}
            onChangeText={setAddStockInput}
            keyboardType="decimal-pad"
            placeholder="e.g. 500"
          />

          <AppButton
            title="Add Gas Stock"
            onPress={handleAddStock}
            variant="primary"
          />
        </BaseCard>

        {/* STATION PRICING TOGGLE */}
        <BaseCard title="Station Refill Pricing Control">
          <Text style={styles.desc}>Station Admin can adjust pricing within platform limits.</Text>
          <AppButton
            title={`Set Price to ${formatCurrency(pricePerKg === 1400 ? 1450 : 1400)} / kg`}
            onPress={handleTogglePrice}
            variant="secondary"
          />
        </BaseCard>

        {/* PUMP ATTENDANTS LIST */}
        <Text style={styles.sectionTitle}>Assigned Pump Attendants ({attendants.length})</Text>
        {attendants.map((att) => (
          <BaseCard key={att.id}>
            <View style={styles.row}>
              <View>
                <Text style={styles.attName}>{att.name}</Text>
                <Text style={styles.attRole}>Refill Confirmation Permissions Granted</Text>
              </View>
              <Badge label={att.status} variant="success" />
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
  grid: { flexDirection: 'row', marginBottom: Spacing.xs },
  label: { color: Colors.textMuted, fontSize: 11, fontWeight: '600' },
  val: { color: Colors.textPrimary, fontSize: 22, fontWeight: 'bold', marginTop: 4 },
  desc: { color: Colors.textMuted, fontSize: 12, marginBottom: Spacing.sm },
  sectionTitle: { color: Colors.textPrimary, fontSize: 16, fontWeight: 'bold', marginVertical: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  attName: { color: Colors.textPrimary, fontSize: 14, fontWeight: 'bold' },
  attRole: { color: Colors.textMuted, fontSize: 11, marginTop: 2 },
});
