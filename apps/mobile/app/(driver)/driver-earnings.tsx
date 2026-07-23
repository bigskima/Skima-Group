import React, { useState } from 'react';
import { Alert, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Colors, Radius, Spacing } from '../../../../src/design-system/theme';
import { AppButton } from '../../../../src/components/buttons/AppButton';
import { BaseCard } from '../../../../src/components/cards/BaseCard';
import { Badge } from '../../../../src/components/common/Badge';
import { formatCurrency, formatDate } from '../../../../src/utils';

export default function DriverEarningsScreen() {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [totalEarnedNgn, setTotalEarnedNgn] = useState<number>(34500.0);
  const [completedTripsCount] = useState<number>(24);

  const payoutHistory = [
    { id: 'pay-1', ref: 'SETTLE-DRIVER-ORD-LPG-90812', orderPublicId: 'ORD-LPG-90812', amount: 500.0, date: new Date().toISOString() },
    { id: 'pay-2', ref: 'SETTLE-DRIVER-ORD-LPG-90810', orderPublicId: 'ORD-LPG-90810', amount: 850.0, date: new Date(Date.now() - 7200000).toISOString() },
    { id: 'pay-3', ref: 'SETTLE-DRIVER-ORD-LPG-90805', orderPublicId: 'ORD-LPG-90805', amount: 1200.0, date: new Date(Date.now() - 86400000).toISOString() },
  ];

  const handleToggleOnline = () => {
    setIsOnline((prev) => !prev);
    Alert.alert(
      isOnline ? 'Went Offline' : 'Online for Dispatch',
      isOnline
        ? 'You will not receive new LPG refill dispatch jobs.'
        : 'You are now visible to the DispatchEngine for Awka zone jobs.',
    );
  };

  const handleWithdrawCommissions = () => {
    Alert.alert(
      'Payout Request Sent',
      `${formatCurrency(totalEarnedNgn)} transferred to your registered bank account via Payment Adapter.`,
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Driver Earnings & Telemetry</Text>
        <Text style={styles.subtitle}>Verified Escrow Commissions • Awka Delivery Operations</Text>

        {/* ONLINE STATUS TOGGLE */}
        <BaseCard style={{ marginBottom: Spacing.md }}>
          <View style={styles.statusRow}>
            <View>
              <Text style={styles.statusTitle}>Dispatch Status</Text>
              <Badge
                label={isOnline ? 'ONLINE & AVAILABLE' : 'OFFLINE'}
                variant={isOnline ? 'success' : 'neutral'}
                pulse={isOnline}
              />
            </View>
            <AppButton
              title={isOnline ? 'Go Offline' : 'Go Online'}
              onPress={handleToggleOnline}
              variant={isOnline ? 'secondary' : 'primary'}
            />
          </View>
        </BaseCard>

        {/* EARNINGS METRICS */}
        <View style={styles.metricsGrid}>
          <BaseCard style={{ flex: 1, marginRight: Spacing.xs }}>
            <Text style={styles.metricLabel}>Total Commission Earned</Text>
            <Text style={[styles.metricVal, { color: Colors.accentGreen }]}>{formatCurrency(totalEarnedNgn)}</Text>
          </BaseCard>

          <BaseCard style={{ flex: 1, marginLeft: Spacing.xs }}>
            <Text style={styles.metricLabel}>Completed Deliveries</Text>
            <Text style={styles.metricVal}>{completedTripsCount} trips</Text>
          </BaseCard>
        </View>

        <AppButton
          title="Withdraw Commissions to Bank Account"
          onPress={handleWithdrawCommissions}
          variant="primary"
          style={{ marginBottom: Spacing.md }}
        />

        {/* COMPLETED TRIPS PAYOUT LOG */}
        <Text style={styles.sectionTitle}>Completed Order Payout History</Text>
        {payoutHistory.map((p) => (
          <BaseCard key={p.id}>
            <View style={styles.historyRow}>
              <View>
                <Text style={styles.orderId}>{p.orderPublicId}</Text>
                <Text style={styles.payRef}>{p.ref}</Text>
                <Text style={styles.payDate}>{formatDate(p.date)}</Text>
              </View>
              <Text style={styles.payoutVal}>+{formatCurrency(p.amount)}</Text>
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
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: 'bold', marginBottom: 4 },
  metricsGrid: { flexDirection: 'row', marginBottom: Spacing.xs },
  metricLabel: { color: Colors.textMuted, fontSize: 11, fontWeight: '600' },
  metricVal: { color: Colors.textPrimary, fontSize: 22, fontWeight: 'bold', marginTop: 4 },
  sectionTitle: { color: Colors.textPrimary, fontSize: 16, fontWeight: 'bold', marginVertical: Spacing.sm },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderId: { color: Colors.textPrimary, fontSize: 14, fontWeight: 'bold' },
  payRef: { color: Colors.textMuted, fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
  payDate: { color: Colors.textMuted, fontSize: 11 },
  payoutVal: { color: Colors.accentGreen, fontSize: 16, fontWeight: 'bold' },
});
