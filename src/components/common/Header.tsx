import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { Colors, Radius, Spacing } from '../../design-system/theme';
import { UserRole } from '../../types';
import { formatCurrency } from '../../utils';

export interface HeaderProps {
  activeRole: UserRole;
  walletBalance?: number;
  unreadNotificationsCount?: number;
  onRolePress?: () => void;
  onNotificationPress?: () => void;
  onWalletPress?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeRole,
  walletBalance = 0,
  unreadNotificationsCount = 2,
  onRolePress,
  onNotificationPress,
  onWalletPress,
}) => {
  const roleColors: Record<UserRole, string> = {
    CUSTOMER: Colors.roleCustomer,
    DRIVER: Colors.roleDriver,
    STATION_ADMIN: Colors.roleStation,
    PUMP_ATTENDANT: Colors.accentTeal,
    MERCHANT: Colors.roleMerchant,
    ADMIN: Colors.roleAdmin,
  };

  return (
    <View style={styles.headerContainer}>
      <View style={styles.leftRow}>
        <View style={styles.logoBadge}>
          <Text style={styles.logoText}>S</Text>
        </View>
        <View>
          <Text style={styles.brandTitle}>SKIMA</Text>
          <TouchableOpacity onPress={onRolePress} style={styles.roleChip}>
            <View style={[styles.roleDot, { backgroundColor: roleColors[activeRole] }]} />
            <Text style={styles.roleText}>{activeRole.replace('_', ' ')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.rightRow}>
        <TouchableOpacity onPress={onWalletPress} style={styles.walletPill}>
          <Text style={styles.walletLabel}>Wallet</Text>
          <Text style={styles.walletVal}>{formatCurrency(walletBalance)}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onNotificationPress} style={styles.notifBtn}>
          <Text style={styles.bellIcon}>🔔</Text>
          {unreadNotificationsCount > 0 && (
            <View style={styles.notifBadge}>
              <Text style={styles.notifBadgeText}>{unreadNotificationsCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: Colors.bgCardBorder,
  },
  leftRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoBadge: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    backgroundColor: Colors.accentFlame,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
  },
  logoText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 22,
  },
  brandTitle: {
    color: Colors.textPrimary,
    fontWeight: '900',
    fontSize: 16,
    letterSpacing: 1,
  },
  roleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  roleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  roleText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  rightRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  walletPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: Colors.bgCardBorder,
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: Spacing.xs,
  },
  walletLabel: {
    color: Colors.textMuted,
    fontSize: 9,
    fontWeight: '600',
  },
  walletVal: {
    color: Colors.accentGreen,
    fontSize: 12,
    fontWeight: 'bold',
  },
  notifBtn: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  bellIcon: {
    fontSize: 16,
  },
  notifBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: Colors.accentFlame,
    borderRadius: 8,
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifBadgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: 'bold',
  },
});
