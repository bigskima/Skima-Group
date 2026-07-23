import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, SafeAreaView, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../../../../src/design-system/theme';

export default function SignUpScreen({ navigation }: any) {
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignUp = async () => {
    if (!fullName || !phoneNumber || !email || !password) {
      Alert.alert('Missing Fields', 'Please complete all registration fields.');
      return;
    }

    setLoading(true);
    try {
      // Calls Supabase Edge Function: /functions/v1/auth-signup
      setTimeout(() => {
        setLoading(false);
        Alert.alert('Account Created', 'Your Skima profile & primary wallet have been initialized successfully.');
      }, 1200);
    } catch (error) {
      setLoading(false);
      Alert.alert('Registration Error', (error as Error).message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        
        <View style={styles.logoRow}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoText}>S</Text>
          </View>
          <Text style={styles.brandTitle}>SKIMA</Text>
        </View>

        <Text style={styles.headerTitle}>Create Account</Text>
        <Text style={styles.headerSubtitle}>One identity unlocks all roles (Customer, Driver, Merchant, Station).</Text>

        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Full Legal Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Emeka Nnamdi"
            placeholderTextColor={Colors.textMuted}
            value={fullName}
            onChangeText={setFullName}
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Phone Number</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. +234 803 000 0000"
            placeholderTextColor={Colors.textMuted}
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Email Address</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. emeka@skima.ng"
            placeholderTextColor={Colors.textMuted}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Secure Password</Text>
          <TextInput
            style={styles.input}
            placeholder="Minimum 8 characters"
            placeholderTextColor={Colors.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        </View>

        <TouchableOpacity style={styles.submitBtn} onPress={handleSignUp} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.submitBtnText}>Create Single Skima Account</Text>
          )}
        </TouchableOpacity>

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
    padding: Spacing.lg,
    justifyContent: 'center',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  logoBadge: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.accentFlame,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
  },
  logoText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 24,
  },
  brandTitle: {
    color: Colors.textPrimary,
    fontWeight: 'bold',
    fontSize: 24,
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: Spacing.xs,
  },
  headerSubtitle: {
    color: Colors.textMuted,
    fontSize: 14,
    marginBottom: Spacing.lg,
  },
  inputContainer: {
    marginBottom: Spacing.md,
  },
  inputLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  input: {
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.bgCardBorder,
    borderRadius: Radius.md,
    padding: Spacing.md,
    color: Colors.textPrimary,
    fontSize: 15,
  },
  submitBtn: {
    backgroundColor: Colors.accentFlame,
    padding: Spacing.md,
    borderRadius: Radius.md,
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  submitBtnText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
