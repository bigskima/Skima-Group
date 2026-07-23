import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Colors, Spacing } from '../../design-system/theme';

export interface LoadingSpinnerProps {
  message?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ message = 'Loading Skima Platform Data...' }) => {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.accentFlame} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginTop: Spacing.sm,
  },
});
