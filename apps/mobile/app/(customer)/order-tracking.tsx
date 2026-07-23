import React, { useMemo, useState } from 'react';
import { Alert, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Colors, Spacing } from '../../../../src/design-system/theme';
import { SkimaMap } from '../../../../src/components/maps/SkimaMap';
import { BaseCard } from '../../../../src/components/cards/BaseCard';
import { AppButton } from '../../../../src/components/buttons/AppButton';
import { LiveTrackingPolicy } from '../../../../src/services/LiveTrackingPolicy';
import { GasOrderStatus } from '../../../../src/types';
import { formatCurrency, formatDate } from '../../../../src/utils';

export default function OrderTrackingScreen() {
  const [orderStatus, setOrderStatus] = useState<GasOrderStatus>('RETURN_IN_TRANSIT');
  const [custodyHolder, setCustodyHolder] = useState<string>('Driver (Chidi K.)');

  const orderDetails = {
    id: 'demo-order-1',
    publicId: 'ORD-LPG-90812',
    customerId: 'demo-customer',
    driverId: 'demo-driver',
    sizeKg: 12.5,
    gasCost: 17500.0,
    deliveryFee: 500.0,
    totalAmount: 18000.0,
    stationName: 'Awka Central LPG Plant',
    driverName: 'Chidi K.',
    deliveryAddress: '14 Zik Avenue, Awka, Anambra State',
    createdAt: new Date().toISOString(),
  };

  const trackingPolicy = useMemo(
    () =>
      LiveTrackingPolicy.evaluate({
        orderStatus,
        requesterRole: 'CUSTOMER',
        requesterUserId: orderDetails.customerId,
        customerId: orderDetails.customerId,
        driverId: orderDetails.driverId,
      }),
    [orderDetails.customerId, orderDetails.driverId, orderStatus],
  );

  const driverCoords = { latitude: 6.2245, longitude: 7.0712 };
  const customerCoords = { latitude: 6.2209, longitude: 7.0671 };
  const stationCoords = [{ id: 'stn-1', name: 'Awka Central', latitude: 6.228, longitude: 7.062 }];

  const handleConfirmDelivery = () => {
    setOrderStatus('COMPLETED');
    setCustodyHolder('Customer (Emeka N.)');
    Alert.alert(
      'Delivery Confirmed',
      `Order ${orderDetails.publicId} completed. Driver payout of ${formatCurrency(orderDetails.deliveryFee)} can be released.`,
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Live Order Tracking</Text>
        <Text style={styles.subtitle}>Order ID: {orderDetails.publicId} - Escrow Protected</Text>

        <SkimaMap
          driverLocation={trackingPolicy.canViewDriverLocation ? driverCoords : undefined}
          customerLocation={customerCoords}
          stationLocations={stationCoords}
          height={220}
        />

        <BaseCard title="Order & Custody Status" badge={orderStatus} badgeColor={Colors.accentFlame}>
          <View style={styles.row}>
            <Text style={styles.key}>Current Custody Holder:</Text>
            <Text style={[styles.val, { color: Colors.accentTeal }]}>{custodyHolder}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.key}>Assigned Driver:</Text>
            <Text style={styles.val}>{orderDetails.driverName}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.key}>Refill Station:</Text>
            <Text style={styles.val}>{orderDetails.stationName}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.key}>Escrow Payment:</Text>
            <Text style={[styles.val, { color: Colors.accentGreen }]}>{formatCurrency(orderDetails.totalAmount)}</Text>
          </View>
          <Text style={styles.privacyNote}>{trackingPolicy.reason}</Text>
        </BaseCard>

        <BaseCard title="Verified Custody Timeline">
          <View style={styles.timelineItem}>
            <Text style={styles.timelineStatus}>Done</Text>
            <View style={styles.timelineTextGroup}>
              <Text style={styles.timelineTitle}>Order Created & Escrow Locked</Text>
              <Text style={styles.timelineTime}>{formatDate(orderDetails.createdAt)}</Text>
            </View>
          </View>

          <View style={styles.timelineItem}>
            <Text style={styles.timelineStatus}>Done</Text>
            <View style={styles.timelineTextGroup}>
              <Text style={styles.timelineTitle}>Cylinder Pickup Scanned by Driver</Text>
              <Text style={styles.timelineSub}>Custody transferred to Driver Chidi K.</Text>
            </View>
          </View>

          <View style={styles.timelineItem}>
            <Text style={styles.timelineStatus}>Done</Text>
            <View style={styles.timelineTextGroup}>
              <Text style={styles.timelineTitle}>Station Refill Verified & Paid</Text>
              <Text style={styles.timelineSub}>Station payout released from escrow.</Text>
            </View>
          </View>

          <View style={styles.timelineItem}>
            <Text style={styles.timelineActive}>Live</Text>
            <View style={styles.timelineTextGroup}>
              <Text style={[styles.timelineTitle, { color: Colors.accentFlame }]}>Return Delivery in Transit</Text>
              <Text style={styles.timelineSub}>Driver is arriving at {orderDetails.deliveryAddress}.</Text>
            </View>
          </View>
        </BaseCard>

        {orderStatus === 'RETURN_IN_TRANSIT' && (
          <AppButton
            title="Confirm Receipt of Cylinder & Complete Order"
            onPress={handleConfirmDelivery}
            variant="primary"
            style={{ marginTop: Spacing.xs }}
          />
        )}
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
  privacyNote: { color: Colors.textMuted, fontSize: 12, marginTop: Spacing.sm },
  timelineItem: { flexDirection: 'row', alignItems: 'flex-start', marginVertical: 8 },
  timelineStatus: { color: Colors.accentGreen, fontWeight: 'bold', fontSize: 12, marginRight: Spacing.sm, width: 36 },
  timelineActive: { color: Colors.accentFlame, fontWeight: 'bold', fontSize: 12, marginRight: Spacing.sm, width: 36 },
  timelineTextGroup: { flex: 1 },
  timelineTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: 'bold' },
  timelineTime: { color: Colors.textMuted, fontSize: 11 },
  timelineSub: { color: Colors.textMuted, fontSize: 12 },
});
