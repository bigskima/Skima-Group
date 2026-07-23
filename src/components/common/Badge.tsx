import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors, Radius, Spacing } from '../../design-system/theme';

export interface BadgeProps {
  label: string;
  variant?: 'success' | 'warning' | 'error' | 'info' | 'flame' | 'teal' | 'neutral';
  pulse?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  label,
  variant = 'teal',
  pulse = false,
}) => {
  const variantStyles: Record<string, { bg: string; text: string; border: string }> = {
    success: { bg: 'rgba(16, 185, 129, 0.15)', text: Colors.accentGreen, border: 'rgba(16, 185, 129, 0.3)' },
    warning: { bg: 'rgba(245, 158, 11, 0.15)', text: Colors.warning, border: 'rgba(245, 158, 11, 0.3)' },
    error: { bg: 'rgba(239, 68, 68, 0.15)', text: Colors.error, border: 'rgba(239, 68, 68, 0.3)' },
    info: { bg: 'rgba(59, 130, 246, 0.15)', text: Colors.info, border: 'rgba(59, 130, 246, 0.3)' },
    flame: { bg: 'rgba(249, 115, 22, 0.15)', text: Colors.accentFlame, border: 'rgba(249, 115, 22, 0.3)' },
    teal: { bg: 'rgba(6, 182, 212, 0.15)', text: Colors.accentTeal, border: 'rgba(6, 182, 212, 0.3)' },
    neutral: { bg: 'rgba(255, 255, 255, 0.08)', text: Colors.textSecondary, border: Colors.bgCardBorder },
  };

  const styleConfig = variantStyles[variant] || variantStyles.teal;

  return (
    <View style={[styles.badge, { backgroundColor: styleConfig.bg, borderColor: styleConfig.border }]}>
      {pulse && <View style={[styles.dot, { backgroundColor: styleConfig.text }]} />}
      <Text style={[styles.badgeText, { color: styleConfig.text }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
