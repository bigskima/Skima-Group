import React, { useMemo, useState } from 'react';
import { Alert, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Colors, Spacing } from '../../../../src/design-system/theme';
import { AppButton } from '../../../../src/components/buttons/AppButton';
import { AppInput } from '../../../../src/components/inputs/AppInput';
import { BaseCard } from '../../../../src/components/cards/BaseCard';
import { AddressEngine } from '../../../../src/services/AddressEngine';
import { ConfigurationEngine } from '../../../../src/services/ConfigurationEngine';
import { formatCurrency } from '../../../../src/utils';

export default function GasOrderScreen() {
  const launchZone = ConfigurationEngine.getLaunchZone();
  const pricing = ConfigurationEngine.getDefaultConfiguration().lpgPricing;
  const [quantityKg, setQuantityKg] = useState('12.5');
  const [deliveryAddress, setDeliveryAddress] = useState('14 Zik Avenue, Awka, Anambra State');
  const [loading, setLoading] = useState(false);

  const deliveryPoint = { latitude: 6.2245, longitude: 7.0712 };
  const distanceKm = AddressEngine.calculateDistanceKm(
    { latitude: launchZone.centerLat, longitude: launchZone.centerLng },
    deliveryPoint,
  );
  const serviceArea = AddressEngine.isWithinServiceArea(deliveryPoint);
  const numKg = parseFloat(quantityKg) || 0;
  const quote = useMemo(
    () => ConfigurationEngine.quoteLpgRefill({ quantityKg: numKg, deliveryDistanceKm: distanceKm }),
    [distanceKm, numKg],
  );

  const handlePlaceOrder = () => {
    if (numKg < pricing.minimumOrderKg || !deliveryAddress.trim()) {
      Alert.alert('Invalid Input', `Enter a delivery address and at least ${pricing.minimumOrderKg}kg.`);
      return;
    }

    if (!serviceArea.supported) {
      Alert.alert('Outside Service Area', serviceArea.message);
      return;
    }

    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      Alert.alert(
        'Gas Order Confirmed',
        `${quantityKg}kg LPG refill created. ${formatCurrency(quote.totalAmount)} locked in Skima escrow.`,
      );
    }, 1200);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Order LPG Gas Refill</Text>
        <Text style={styles.subtitle}>
          {launchZone.label}: station dispatch, escrow, custody, and live tracking
        </Text>

        <BaseCard title="Cylinder Details" badge="12.5 kg Registered" badgeColor={Colors.accentGreen}>
          <View style={styles.row}>
            <Text style={styles.key}>QR Code:</Text>
            <Text style={styles.val}>SKM-CYL-12.5-90182</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.key}>Current Custody:</Text>
            <Text style={[styles.val, { color: Colors.accentTeal }]}>Customer (Emeka N.)</Text>
          </View>
        </BaseCard>

        <BaseCard title="Refill Parameters">
          <AppInput
            label="Refill Quantity (kg)"
            value={quantityKg}
            onChangeText={setQuantityKg}
            keyboardType="decimal-pad"
            placeholder="e.g. 12.5"
          />

          <AppInput
            label="Delivery Location Address"
            value={deliveryAddress}
            onChangeText={setDeliveryAddress}
            placeholder="e.g. Street name, Awka"
          />
        </BaseCard>

        <BaseCard title="Escrow Payment Breakdown" badge="Escrow Protected" badgeColor={Colors.accentFlame}>
          <View style={styles.row}>
            <Text style={styles.key}>
              Gas Cost ({quote.quantityKg}kg at {formatCurrency(pricing.gasPricePerKg)}/kg):
            </Text>
            <Text style={styles.val}>{formatCurrency(quote.gasCost)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.key}>Delivery Fee ({distanceKm}km):</Text>
            <Text style={styles.val}>{formatCurrency(quote.deliveryFee)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.key}>Platform Commission Policy:</Text>
            <Text style={styles.val}>{pricing.platformCommissionPercent}%</Text>
          </View>
          <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalKey}>Total Amount Locked:</Text>
            <Text style={styles.totalVal}>{formatCurrency(quote.totalAmount)}</Text>
          </View>
        </BaseCard>

        <AppButton
          title={`Confirm and Lock ${formatCurrency(quote.totalAmount)}`}
          onPress={handlePlaceOrder}
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
  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: 'bold', marginBottom: 2 },
  subtitle: { color: Colors.textMuted, fontSize: 13, marginBottom: Spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 4 },
  key: { color: Colors.textMuted, fontSize: 13, flex: 1, marginRight: Spacing.sm },
  val: { color: Colors.textPrimary, fontSize: 13, fontWeight: 'bold', textAlign: 'right', flexShrink: 0 },
  totalRow: { borderTopWidth: 1, borderTopColor: Colors.bgCardBorder, paddingTop: Spacing.sm, marginTop: Spacing.xs },
  totalKey: { color: Colors.textPrimary, fontSize: 15, fontWeight: 'bold', flex: 1 },
  totalVal: { color: Colors.accentFlame, fontSize: 18, fontWeight: 'bold', textAlign: 'right' },
});
