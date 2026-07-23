import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TextInputProps, TouchableOpacity } from 'react-native';
import { Colors, Radius, Spacing } from '../../design-system/theme';

export interface AppInputProps extends TextInputProps {
  label?: string;
  error?: string;
  secureTextEntry?: boolean;
}

export const AppInput: React.FC<AppInputProps> = ({
  label,
  error,
  secureTextEntry = false,
  style,
  ...restProps
}) => {
  const [isPasswordVisible, setIsPasswordVisible] = useState(!secureTextEntry);

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.inputWrapper, error ? styles.borderError : styles.borderNormal]}>
        <TextInput
          style={[styles.input, style]}
          placeholderTextColor={Colors.textMuted}
          secureTextEntry={secureTextEntry && !isPasswordVisible}
          {...restProps}
        />
        {secureTextEntry && (
          <TouchableOpacity onPress={() => setIsPasswordVisible(!isPasswordVisible)} style={styles.toggleBtn}>
            <Text style={styles.toggleText}>{isPasswordVisible ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        )}
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.md,
    width: '100%',
  },
  label: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
  },
  borderNormal: {
    borderColor: Colors.bgCardBorder,
  },
  borderError: {
    borderColor: Colors.error,
  },
  input: {
    flex: 1,
    paddingVertical: Spacing.md,
    color: Colors.textPrimary,
    fontSize: 15,
  },
  toggleBtn: {
    paddingLeft: Spacing.sm,
  },
  toggleText: {
    color: Colors.accentFlame,
    fontSize: 12,
    fontWeight: '700',
  },
  errorText: {
    color: Colors.error,
    fontSize: 12,
    marginTop: 4,
  },
});
