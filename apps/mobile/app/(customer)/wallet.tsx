import React, { useState } from 'react';
import { Alert, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Colors, Radius, Spacing } from '../../../../src/design-system/theme';
import { AppButton } from '../../../../src/components/buttons/AppButton';
import { AppInput } from '../../../../src/components/inputs/AppInput';
import { BaseCard } from '../../../../src/components/cards/BaseCard';
import { Badge } from '../../../../src/components/common/Badge';
import { PaystackAdapter } from '../../../../src/services/PaymentGatewayAdapter';
import { formatCurrency, formatDate } from '../../../../src/utils';

export default function WalletScreen() {
  const [balance, setBalance] = useState<number>(45800.0);
  const [lockedEscrow, setLockedEscrow] = useState<number>(18000.0);
  const [depositAmount, setDepositAmount] = useState<string>('10000');
  const [loading, setLoading] = useState<boolean>(false);

  const transactions = [
    { id: 'trx-1', ref: 'PSTK-DEP-90812398', type: 'DEPOSIT', amount: 10000.0, status: 'COMPLETED', time: new Date().toISOString() },
    { id: 'trx-2', ref: 'ESC-HOLD-ORD-LPG-90812', type: 'ESCROW_HOLD', amount: 18000.0, status: 'LOCKED', time: new Date(Date.now() - 3600000).toISOString() },
    { id: 'trx-3', ref: 'BILL-AIRTIME-89102', type: 'BILL_PAYMENT', amount: 1000.0, status: 'COMPLETED', time: new Date(Date.now() - 86400000).toISOString() },
  ];

  const handleFundWallet = async () => {
    const numAmount = parseFloat(depositAmount) || 0;
    if (numAmount < 100) {
      Alert.alert('Minimum Deposit', 'Minimum funding amount is ₦100.');
      return;
    }

    setLoading(true);
    const adapter = new PaystackAdapter();
    const reference = `SKM-DEP-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;

    const res = await adapter.initializeTransaction({
      email: 'customer@skima.ng',
      amountNgn: numAmount,
      reference,
    });

    setLoading(false);

    if (!res.success) {
      Alert.alert('Payment Error', res.errorMessage ?? 'Payment initialization failed.');
      return;
    }

    // Direct mock completion for interactive testing
    setBalance((prev) => prev + numAmount);
    Alert.alert(
      'Wallet Funded',
      `Successfully deposited ${formatCurrency(numAmount)} via Paystack Adapter.\nReference: ${reference}`,
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Platform NGN Wallet</Text>
        <Text style={styles.subtitle}>Single Wallet • Atomic Escrow Holds • Instant Withdrawals</Text>

        {/* BALANCE CARDS */}
        <View style={styles.balanceGrid}>
          <BaseCard style={{ flex: 1, marginRight: Spacing.xs }}>
            <Text style={styles.cardLabel}>Available Balance</Text>
            <Text style={styles.balanceText}>{formatCurrency(balance)}</Text>
          </BaseCard>

          <BaseCard style={{ flex: 1, marginLeft: Spacing.xs }}>
            <Text style={styles.cardLabel}>Locked in Escrow</Text>
            <Text style={[styles.balanceText, { color: Colors.accentTeal }]}>{formatCurrency(lockedEscrow)}</Text>
          </BaseCard>
        </View>

        {/* DEPOSIT SECTION */}
        <BaseCard title="Fund Wallet via Paystack Adapter" badge="SECURE GATEWAY" badgeColor={Colors.accentGreen}>
          <AppInput
            label="Deposit Amount (NGN)"
            value={depositAmount}
            onChangeText={setDepositAmount}
            keyboardType="decimal-pad"
            placeholder="e.g. 10000"
          />

          <AppButton
            title={`Deposit ${formatCurrency(parseFloat(depositAmount) || 0)}`}
            onPress={handleFundWallet}
            loading={loading}
            variant="primary"
          />
        </BaseCard>

        {/* TRANSACTION HISTORY */}
        <Text style={styles.sectionTitle}>Ledger Transaction History ({transactions.length})</Text>
        {transactions.map((tx) => (
          <BaseCard key={tx.id}>
            <View style={styles.row}>
              <View>
                <Text style={styles.txRef}>{tx.ref}</Text>
                <Text style={styles.txType}>{tx.type.replace('_', ' ')} • {formatDate(tx.time)}</Text>
              </div>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.txAmount, tx.type === 'DEPOSIT' ? { color: Colors.accentGreen } : { color: Colors.textPrimary }]}>
                  {tx.type === 'DEPOSIT' ? '+' : '-'}{formatCurrency(tx.amount)}
                </Text>
                <Badge
                  label={tx.status}
                  variant={tx.status === 'COMPLETED' ? 'success' : 'warning'}
                />
              </View>
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
  balanceGrid: { flexDirection: 'row', marginBottom: Spacing.xs },
  cardLabel: { color: Colors.textMuted, fontSize: 11, fontWeight: '600' },
  balanceText: { color: Colors.textPrimary, fontSize: 22, fontWeight: 'bold', marginTop: 4 },
  sectionTitle: { color: Colors.textPrimary, fontSize: 16, fontWeight: 'bold', marginVertical: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  txRef: { color: Colors.textPrimary, fontSize: 13, fontWeight: 'bold', fontFamily: 'monospace' },
  txType: { color: Colors.textMuted, fontSize: 11, marginTop: 2 },
  txAmount: { fontSize: 15, fontWeight: 'bold', marginBottom: 4 },
});
