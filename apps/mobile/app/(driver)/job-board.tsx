import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, SafeAreaView, Alert } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../../../../src/design-system/theme';
import { AppButton } from '../../../../src/components/buttons/AppButton';
import { BaseCard } from '../../../../src/components/cards/BaseCard';
import { formatCurrency } from '../../../../src/utils';

export default function DriverJobBoardScreen() {
  const [activeJob, setActiveJob] = useState<any>(null);

  const availableJobs = [
    {
      id: 'ORD-LPG-90812',
      customerName: 'Emeka N.',
      address: '14 Zik Avenue, Awka',
      station: 'Awka Central LPG Plant',
      distanceKm: 3.2,
      driverFee: 500,
      quantityKg: 12.5,
    },
    {
      id: 'ORD-LPG-90815',
      customerName: 'Nneka O.',
      address: 'Arthur Eze Avenue, Awka',
      station: 'Juhel Gas Station Awka',
      distanceKm: 5.8,
      driverFee: 850,
      quantityKg: 25.0,
    },
  ];

  const handleAcceptJob = (job: any) => {
    setActiveJob(job);
    Alert.alert('Job Accepted', `You accepted Order ${job.id}. Proceed to customer location to scan cylinder QR code.`);
  };

  const handleScanPickup = () => {
    Alert.alert('QR Scan Success', 'Cylinder custody transferred to Driver. Transport cylinder to assigned station.');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        
        <Text style={styles.title}>Driver Dispatch Console</Text>
        <Text style={styles.subtitle}>Awka Logistics Zone • Earn Instant Delivery Commissions</Text>

        {activeJob ? (
          <BaseCard title={`Active Job: ${activeJob.id}`} badge="IN PROGRESS" badgeColor={Colors.accentFlame}>
            <View style={styles.row}>
              <Text style={styles.key}>Customer:</Text>
              <Text style={styles.val}>{activeJob.customerName}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.key}>Pickup Address:</Text>
              <Text style={styles.val}>{activeJob.address}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.key}>Assigned Station:</Text>
              <Text style={styles.val}>{activeJob.station}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.key}>Earnings Payout:</Text>
              <Text style={[styles.val, { color: Colors.accentGreen }]}>{formatCurrency(activeJob.driverFee)}</Text>
            </View>

            <AppButton
              title="Scan Cylinder QR Code"
              onPress={handleScanPickup}
              variant="secondary"
              style={{ marginTop: Spacing.md }}
            />
          </BaseCard>
        ) : (
          <View>
            <Text style={styles.sectionTitle}>Available Gas Dispatch Jobs in Awka ({availableJobs.length})</Text>
            {availableJobs.map(job => (
              <BaseCard key={job.id} title={job.id} badge={`${job.distanceKm} km away`} badgeColor={Colors.accentTeal}>
                <View style={styles.row}>
                  <Text style={styles.key}>Customer:</Text>
                  <Text style={styles.val}>{job.customerName}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.key}>Pickup Address:</Text>
                  <Text style={styles.val}>{job.address}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.key}>Refill Weight:</Text>
                  <Text style={styles.val}>{job.quantityKg} kg</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.key}>Driver Commission:</Text>
                  <Text style={[styles.val, { color: Colors.accentGreen }]}>{formatCurrency(job.driverFee)}</Text>
                </View>

                <AppButton
                  title="Accept Dispatch Job"
                  onPress={() => handleAcceptJob(job)}
                  variant="primary"
                  style={{ marginTop: Spacing.sm }}
                />
              </BaseCard>
            ))}
          </View>
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
  sectionTitle: { color: Colors.textPrimary, fontSize: 16, fontWeight: 'bold', marginBottom: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 4 },
  key: { color: Colors.textMuted, fontSize: 13 },
  val: { color: Colors.textPrimary, fontSize: 13, fontWeight: 'bold' },
});
