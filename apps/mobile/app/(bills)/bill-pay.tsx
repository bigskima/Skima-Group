import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, SafeAreaView, TouchableOpacity, Alert } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../../../../src/design-system/theme';
import { AppButton } from '../../../../src/components/buttons/AppButton';
import { AppInput } from '../../../../src/components/inputs/AppInput';
import { BaseCard } from '../../../../src/components/cards/BaseCard';
import { formatCurrency } from '../../../../src/utils';

import { BillsEngine } from '../../../../src/services/BillsEngine';

export default function BillPayScreen() {
  const [selectedBiller, setSelectedBiller] = useState<'AIRTIME' | 'DATA' | 'ELECTRICITY' | 'CABLE_TV'>('AIRTIME');
  const [accountNumber, setAccountNumber] = useState('');
  const [amount, setAmount] = useState('1000');
  const [loading, setLoading] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number>(45800.0);

  const billers = [
    { type: 'AIRTIME', label: 'Airtime Topup', provider: 'MTN / GLO / Airtel / 9mobile' },
    { type: 'DATA', label: 'Mobile Data', provider: 'SME & Direct Data Bundles' },
    { type: 'ELECTRICITY', label: 'Electricity Token', provider: 'EEDC Awka / IKEDC' },
    { type: 'CABLE_TV', label: 'Cable TV Subscription', provider: 'DSTV / GOTV / Startimes' },
  ];

  const handleExecuteBillPayment = () => {
    const numAmount = parseFloat(amount) || 0;
    const providerList = BillsEngine.getProviders(selectedBiller);
    const selectedProvider = providerList[0] ?? { code: 'DEFAULT', name: selectedBiller };

    setLoading(true);
    setTimeout(() => {
      setLoading(false);

      const result = BillsEngine.processBillPayment({
        userId: 'usr-demo',
        billerType: selectedBiller,
        providerCode: selectedProvider.code,
        providerName: selectedProvider.name,
        customerIdentifier: accountNumber,
        amountNgn: numAmount,
        walletBalanceNgn: walletBalance,
      });

      if (!result.success || !result.newBalanceNgn) {
        Alert.alert('Payment Failed', result.errorMessage ?? 'Could not process bill payment.');
        return;
      }

      setWalletBalance(result.newBalanceNgn);
      Alert.alert(
        'Bill Payment Successful',
        `${selectedBiller} payment of ${formatCurrency(numAmount)} for ${accountNumber} processed successfully via ${selectedProvider.name}. Reference: ${result.reference}.`,
      );
    }, 800);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        
        <Text style={styles.title}>Utility & Bill Payments</Text>
        <Text style={styles.subtitle}>Instant Wallet Payments • Zero Convenience Fee</Text>

        {/* BILL TYPE SELECTOR */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.billerScrollView}>
          {billers.map((b) => (
            <TouchableOpacity
              key={b.type}
              style={[styles.billerChip, selectedBiller === b.type && styles.billerChipActive]}
              onPress={() => setSelectedBiller(b.type as any)}
            >
              <Text style={[styles.billerChipText, selectedBiller === b.type && styles.billerChipTextActive]}>
                {b.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <BaseCard title={`${selectedBiller} Details`} badge="ADAPTER INTEGRATED" badgeColor={Colors.accentTeal}>
          <AppInput
            label={selectedBiller === 'AIRTIME' || selectedBiller === 'DATA' ? 'Phone Number' : 'Meter / Smartcard Number'}
            placeholder="e.g. 0803 123 4567"
            value={accountNumber}
            onChangeText={setAccountNumber}
            keyboardType="numeric"
          />

          <AppInput
            label="Payment Amount (NGN)"
            placeholder="e.g. 1000"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
        </BaseCard>

        <AppButton
          title={`Pay ${formatCurrency(parseFloat(amount) || 0)} from Wallet`}
          onPress={handleExecuteBillPayment}
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
  billerScrollView: { flexDirection: 'row', marginBottom: Spacing.md },
  billerChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: Radius.full,
    backgroundColor: Colors.bgCard,
    marginRight: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.bgCardBorder,
  },
  billerChipActive: {
    backgroundColor: Colors.accentFlame,
    borderColor: Colors.accentFlame,
  },
  billerChipText: { color: Colors.textMuted, fontSize: 13, fontWeight: '600' },
  billerChipTextActive: { color: '#FFF' },
});
