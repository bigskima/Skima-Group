import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, SafeAreaView, Alert } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../../../../src/design-system/theme';
import { AppButton } from '../../../../src/components/buttons/AppButton';
import { BaseCard } from '../../../../src/components/cards/BaseCard';
import { formatCurrency } from '../../../../src/utils';

export default function StationTerminalScreen() {
  const [stationStockKg, setStationStockKg] = useState<number>(850.0);
  const [dailyPayoutsNgn, setDailyPayoutsNgn] = useState<number>(142500.0);

  const pendingRefills = [
    {
      orderId: 'ORD-LPG-90812',
      cylinderQr: 'SKM-CYL-12.5-90182',
      sizeKg: 12.5,
      payoutNgn: 17500.0,
      driverName: 'Chidi K.',
    },
  ];

  const handleVerifyRefill = (refill: { orderId: string; cylinderQr: string; sizeKg: number; payoutNgn: number; driverName: string }) => {
    setStationStockKg((prev: number) => prev - refill.sizeKg);
    setDailyPayoutsNgn((prev: number) => prev + refill.payoutNgn);
    Alert.alert(
      'Refill Verified',
      `Cylinder ${refill.cylinderQr} refilled (${refill.sizeKg}kg). Station Wallet payout of ${formatCurrency(refill.payoutNgn)} released from Escrow!`,
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        
        <Text style={styles.title}>LPG Station Terminal</Text>
        <Text style={styles.subtitle}>Awka Central Plant • Refill Verification & Instant Escrow Settlements</Text>

        {/* STATION METRICS */}
        <View style={styles.metricsRow}>
          <BaseCard title="Available Stock" style={{ flex: 1, marginRight: Spacing.xs }}>
            <Text style={styles.metricVal}>{stationStockKg} kg</Text>
          </BaseCard>
          <BaseCard title="Daily Payouts" style={{ flex: 1, marginLeft: Spacing.xs }}>
            <Text style={[styles.metricVal, { color: Colors.accentGreen }]}>{formatCurrency(dailyPayoutsNgn)}</Text>
          </BaseCard>
        </View>

        {/* PENDING REFILL QUEUE */}
        <Text style={styles.sectionTitle}>Incoming Cylinder Refills ({pendingRefills.length})</Text>
        {pendingRefills.map((item) => (
          <BaseCard key={item.orderId} title={item.orderId} badge="AT STATION" badgeColor={Colors.accentTeal}>
            <View style={styles.row}>
              <Text style={styles.key}>Cylinder QR:</Text>
              <Text style={styles.val}>{item.cylinderQr}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.key}>Refill Weight:</Text>
              <Text style={styles.val}>{item.sizeKg} kg</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.key}>Delivered by Driver:</Text>
              <Text style={styles.val}>{item.driverName}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.key}>Escrow Payout to Station:</Text>
              <Text style={[styles.val, { color: Colors.accentGreen }]}>{formatCurrency(item.payoutNgn)}</Text>
            </View>

            <AppButton
              title="Scan QR & Confirm Refill Completion"
              onPress={() => handleVerifyRefill(item)}
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
  metricsRow: { flexDirection: 'row', marginBottom: Spacing.xs },
  metricVal: { color: Colors.textPrimary, fontSize: 20, fontWeight: 'bold', marginTop: 4 },
  sectionTitle: { color: Colors.textPrimary, fontSize: 16, fontWeight: 'bold', marginBottom: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 4 },
  key: { color: Colors.textMuted, fontSize: 13 },
  val: { color: Colors.textPrimary, fontSize: 13, fontWeight: 'bold' },
});
