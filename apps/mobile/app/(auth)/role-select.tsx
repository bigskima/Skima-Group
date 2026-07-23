import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, SafeAreaView, ScrollView } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../../../../src/design-system/theme';

export default function RoleSelectScreen() {
  const roles = [
    { title: 'Customer', desc: 'Order LPG gas refills, shop marketplace, and pay bills.', status: 'VERIFIED', color: Colors.roleCustomer },
    { title: 'Driver', desc: 'Accept logistics jobs, transport cylinders, earn commissions.', status: 'VERIFIED', color: Colors.roleDriver },
    { title: 'LPG Station Admin / Attendant', desc: 'Refill cylinders, verify scans, receive station payouts.', status: 'VERIFIED', color: Colors.roleStation },
    { title: 'Marketplace Merchant', desc: 'List store inventory, fulfill orders, withdraw revenue.', status: 'UNLOCKED_KYC_NEEDED', color: Colors.roleMerchant },
    { title: 'System Administrator', desc: 'Platform governance, gas pricing, zone polygons.', status: 'RESTRICTED', color: Colors.roleAdmin },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>One Account, Multiple Roles</Text>
        <Text style={styles.subtitle}>Select an active role interface or unlock new capabilities.</Text>

        {roles.map((r, idx) => (
          <TouchableOpacity key={idx} style={[styles.roleCard, { borderColor: r.color }]}>
            <View style={styles.roleHeader}>
              <Text style={[styles.roleTitle, { color: r.color }]}>{r.title}</Text>
              <Text style={styles.statusBadge}>{r.status}</Text>
            </View>
            <Text style={styles.roleDesc}>{r.desc}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgDark,
  },
  content: {
    padding: Spacing.md,
  },
  title: {
    color: Colors.textPrimary,
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: Spacing.xs,
  },
  subtitle: {
    color: Colors.textMuted,
    fontSize: 14,
    marginBottom: Spacing.lg,
  },
  roleCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
  },
  roleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  roleTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  statusBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textMuted,
    backgroundColor: Colors.bgDark,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  roleDesc: {
    color: Colors.textMuted,
    fontSize: 13,
  },
});
