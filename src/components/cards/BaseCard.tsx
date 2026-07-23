import React from 'react';
import { StyleSheet, View, Text, ViewStyle } from 'react-native';
import { Colors, Radius, Spacing, Shadows } from '../../design-system/theme';

export interface BaseCardProps {
  title?: string;
  badge?: string;
  badgeColor?: string;
  children: React.ReactNode;
  style?: ViewStyle;
}

export const BaseCard: React.FC<BaseCardProps> = ({
  title,
  badge,
  badgeColor = Colors.accentTeal,
  children,
  style,
}) => {
  return (
    <View style={[styles.card, Shadows.card, style]}>
      {title && (
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          {badge && (
            <View style={[styles.badgeContainer, { backgroundColor: `${badgeColor}20`, borderColor: `${badgeColor}40` }]}>
              <Text style={[styles.badgeText, { color: badgeColor }]}>{badge}</Text>
            </View>
          )}
        </View>
      )}
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.bgCardBorder,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  title: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  badgeContainer: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
