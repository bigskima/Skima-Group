import React, { useMemo, useState } from 'react';
import { Alert, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Radius, Spacing } from '../../src/design-system/theme';
import { CylinderStatus, UserRole } from '../../src/types';
import { AddressEngine } from '../../src/services/AddressEngine';
import { ConfigurationEngine } from '../../src/services/ConfigurationEngine';
import { CustodyEngine } from '../../src/services/CustodyEngine';
import { SettlementEngine } from '../../src/services/SettlementEngine';
import { Header } from '../../src/components/common/Header';
import { Badge } from '../../src/components/common/Badge';
import { formatCurrency } from '../../src/utils';

const custodyHolderByStatus: Record<CylinderStatus, string> = {
  IDLE: 'Customer (Emeka N.)',
  IN_TRANSIT_TO_STATION: 'Driver (Chidi K.)',
  AT_STATION: 'Awka Central LPG Station',
  REFILLED: 'Awka Central LPG Station',
  IN_TRANSIT_TO_CUSTOMER: 'Driver (Chidi K.)',
};

export default function App() {
  const config = ConfigurationEngine.getDefaultConfiguration();
  const launchZone = ConfigurationEngine.getLaunchZone();
  const [activeRole, setActiveRole] = useState<UserRole>('CUSTOMER');
  const [walletBalance, setWalletBalance] = useState<number>(45800.0);
  const [lockedEscrow, setLockedEscrow] = useState<number>(0);
  const [cylinderStatus, setCylinderStatus] = useState<CylinderStatus>('IDLE');
  const [custodyHolder, setCustodyHolder] = useState<string>(custodyHolderByStatus.IDLE);
  const [gasPricePerKg, setGasPricePerKg] = useState<number>(config.lpgPricing.gasPricePerKg);

  const orderQuote = useMemo(
    () =>
      ConfigurationEngine.quoteLpgRefill({
        quantityKg: 12.5,
        stationPricePerKg: gasPricePerKg,
      }),
    [gasPricePerKg],
  );

  const serviceArea = AddressEngine.isWithinServiceArea({
    latitude: launchZone.centerLat,
    longitude: launchZone.centerLng,
  });

  const handlePlaceOrder = () => {
    if (walletBalance < orderQuote.totalAmount) {
      Alert.alert('Insufficient Funds', 'Please fund your wallet first.');
      return;
    }

    setWalletBalance((prev) => prev - orderQuote.totalAmount);
    setLockedEscrow(orderQuote.totalAmount);
    setCylinderStatus('IN_TRANSIT_TO_STATION');
    setCustodyHolder(custodyHolderByStatus.IN_TRANSIT_TO_STATION);
    Alert.alert(
      'Order Created',
      `${formatCurrency(orderQuote.totalAmount)} locked in escrow. Driver dispatched for ${launchZone.city}.`,
    );
  };

  const handleSettlementTrigger = (trigger: 'STATION_PAYMENT' | 'FULL_ORDER_COMPLETION') => {
    const settlement = SettlementEngine.evaluateGasOrderSettlement({
      orderId: 'demo-order-1',
      publicId: 'ORD-LPG-90812',
      status: trigger === 'STATION_PAYMENT' ? 'REFILL_COMPLETED' : 'COMPLETED',
      escrowStatus: trigger === 'STATION_PAYMENT' ? 'LOCKED' : 'PARTIALLY_RELEASED',
      customerId: 'demo-customer',
      stationOwnerUserId: 'demo-station-owner',
      driverId: 'demo-driver',
      gasCost: orderQuote.gasCost,
      deliveryFee: orderQuote.deliveryFee,
      trigger,
    });

    if (!settlement.allowed || !settlement.amount) {
      Alert.alert('Settlement Held', settlement.reason);
      return;
    }

    setLockedEscrow((prev) => Math.max(0, prev - settlement.amount));
    Alert.alert('Settlement Released', `${formatCurrency(settlement.amount)} released. ${settlement.reason}`);
  };

  const handleScanQR = () => {
    const result = CustodyEngine.evaluateTransition({
      cylinderId: 'demo-cylinder-1',
      qrCode: 'SKM-CYL-12.5-90182',
      currentStatus: cylinderStatus,
      scannedByUserId: `demo-${activeRole.toLowerCase()}`,
      scannedByRole: activeRole,
      targetCustodyUserId: `demo-${activeRole.toLowerCase()}`,
      latitude: launchZone.centerLat,
      longitude: launchZone.centerLng,
    });

    if (!result.allowed || !result.nextStatus) {
      Alert.alert('Scan Rejected', result.reason ?? 'This custody transition is not allowed.');
      return;
    }

    setCylinderStatus(result.nextStatus);
    setCustodyHolder(custodyHolderByStatus[result.nextStatus]);

    if (result.triggerEscrowRelease === 'STATION_PAYMENT') {
      handleSettlementTrigger('STATION_PAYMENT');
      return;
    }

    if (result.triggerEscrowRelease === 'FULL_ORDER_COMPLETION') {
      handleSettlementTrigger('FULL_ORDER_COMPLETION');
      return;
    }

    Alert.alert('Custody Transfer', `Cylinder status updated to ${result.nextStatus}.`);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* LEGO HEADER */}
      <Header
        activeRole={activeRole}
        walletBalance={walletBalance}
        unreadNotificationsCount={2}
        onWalletPress={() => Alert.alert('Platform Wallet', `Available: ${formatCurrency(walletBalance)}\nLocked Escrow: ${formatCurrency(lockedEscrow)}`)}
        onNotificationPress={() => Alert.alert('System Notifications', '• ₦18,000 locked in escrow for Order ORD-LPG-90812.\n• Refill complete at Awka Central Station.')}
      />

      {/* ROLE SELECTOR SCRAPPER BAR */}
      <View style={styles.roleBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {(['CUSTOMER', 'DRIVER', 'PUMP_ATTENDANT', 'STATION_ADMIN', 'MERCHANT', 'ADMIN'] as UserRole[]).map((role) => (
            <TouchableOpacity
              key={role}
              style={[styles.roleChip, activeRole === role && styles.roleChipActive]}
              onPress={() => setActiveRole(role)}
            >
              <Text style={[styles.roleChipText, activeRole === role && styles.roleChipTextActive]}>
                {role.replace('_', ' ')}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* WALLET SUMMARY */}
        <View style={styles.walletCard}>
          <View style={styles.walletRow}>
            <Text style={styles.walletLabel}>Platform Wallet Balance</Text>
            <Badge label={`${formatCurrency(lockedEscrow)} Locked`} variant="teal" />
          </View>
          <Text style={styles.balanceText}>{formatCurrency(walletBalance)}</Text>
          <TouchableOpacity style={styles.fundBtn} onPress={() => setWalletBalance((prev) => prev + 10000)}>
            <Text style={styles.fundBtnText}>+ Fund Wallet via Paystack Adapter</Text>
          </TouchableOpacity>
        </View>

        {/* REGISTERED CYLINDER STATUS */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm }}>
            <Text style={styles.cardTitle}>Registered Cylinder (12.5kg)</Text>
            <Badge label={cylinderStatus} variant={cylinderStatus === 'IDLE' ? 'neutral' : 'flame'} pulse={cylinderStatus !== 'IDLE'} />
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoKey}>QR Code:</Text>
            <Text style={styles.infoVal}>SKM-CYL-12.5-90182</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoKey}>Current Custody:</Text>
            <Text style={[styles.infoVal, { color: Colors.accentTeal }]}>{custodyHolder}</Text>
          </View>
        </View>

        {/* CUSTOMER CONSOLE */}
        {activeRole === 'CUSTOMER' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Customer Gas Refill Console</Text>
            <Text style={styles.descText}>
              Zone: {launchZone.city}, {launchZone.state} ({serviceArea.message})
            </Text>
            <Text style={styles.descText}>
              Quote: 12.5kg at {formatCurrency(gasPricePerKg)}/kg, Total {formatCurrency(orderQuote.totalAmount)}
            </Text>
            <TouchableOpacity style={styles.actionBtn} onPress={handlePlaceOrder}>
              <Text style={styles.actionBtnText}>Place 12.5kg Gas Order ({formatCurrency(orderQuote.totalAmount)})</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* DRIVER / STATION CONSOLE */}
        {(activeRole === 'DRIVER' || activeRole === 'STATION_ADMIN' || activeRole === 'PUMP_ATTENDANT') && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {activeRole === 'DRIVER' ? 'Driver Dispatch & QR Scanner' : 'Station Attendant Terminal'}
            </Text>
            <Text style={styles.descText}>Scan physical cylinder QR code to transfer custody and release escrow payouts.</Text>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: Colors.accentTeal }]} onPress={handleScanQR}>
              <Text style={styles.actionBtnText}>Scan Cylinder QR Code</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ADMIN CONSOLE */}
        {activeRole === 'ADMIN' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Admin Governance Control</Text>
            <Text style={styles.descText}>Configuration drives system pricing, service zones, registration, and RLS policies.</Text>
            <View style={styles.infoRow}>
              <Text style={styles.infoKey}>LPG Gas Price / kg:</Text>
              <TouchableOpacity onPress={() => setGasPricePerKg((prev) => (prev === 1400 ? 1500 : 1400))}>
                <Text style={[styles.infoVal, { color: Colors.accentGreen }]}>
                  {formatCurrency(gasPricePerKg)} (Tap to toggle)
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgDark,
  },
  roleBar: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    backgroundColor: Colors.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: Colors.bgCardBorder,
  },
  roleChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.bgDark,
    marginRight: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.bgCardBorder,
  },
  roleChipActive: {
    backgroundColor: Colors.accentFlame,
    borderColor: Colors.accentFlame,
  },
  roleChipText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  roleChipTextActive: {
    color: '#FFF',
  },
  content: {
    padding: Spacing.md,
  },
  walletCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.bgCardBorder,
  },
  walletRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  walletLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  balanceText: {
    color: Colors.textPrimary,
    fontSize: 32,
    fontWeight: 'bold',
    marginVertical: Spacing.xs,
  },
  fundBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    padding: Spacing.sm,
    borderRadius: Radius.md,
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  fundBtnText: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  card: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.bgCardBorder,
  },
  cardTitle: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  infoRow: {
    flexDirection: 'row',
    justify.content: 'space-between',
    marginVertical: 4,
  },
  infoKey: {
    color: Colors.textMuted,
    fontSize: 13,
  },
  infoVal: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: 'bold',
  },
  descText: {
    color: Colors.textMuted,
    fontSize: 13,
    marginBottom: Spacing.sm,
  },
  actionBtn: {
    backgroundColor: Colors.accentFlame,
    padding: Spacing.md,
    borderRadius: Radius.md,
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  actionBtnText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
