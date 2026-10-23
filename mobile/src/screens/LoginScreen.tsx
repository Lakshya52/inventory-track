import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { useSync } from '../sync/SyncContext';
import { Button, Card, Field, Screen } from '../components/ui';
import { colors, radius, spacing } from '../theme';

export default function LoginScreen() {
  const { login, authError } = useAuth();
  const { online } = useSync();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err?.message || 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Text style={styles.logoText}>A</Text>
            </View>
            <Text style={styles.title}>Aceone Inventory</Text>
            <Text style={styles.subtitle}>QC and dispatch field work, online or offline</Text>
          </View>

          <Card style={{ gap: spacing.lg }}>
            <View style={styles.offlineRow}>
              <Ionicons
                name={online ? 'wifi-outline' : 'cloud-offline-outline'}
                size={16}
                color={online ? colors.success : colors.warning}
              />
              <Text style={[styles.offlineText, { color: online ? colors.success : colors.warning }]}>
                {online ? 'Connected' : 'Offline — work will sync later'}
              </Text>
            </View>

            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="you@example.com"
              textContentType="emailAddress"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Your password"
              textContentType="password"
              onSubmitEditing={() => void submit()}
            />

            {(error || authError) ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
                <Text style={styles.errorText}>{error || authError}</Text>
              </View>
            ) : null}

            <Button title="Sign in" onPress={() => void submit()} loading={busy} />

            <Text style={styles.hint}>
              After the first successful sign-in, the app can be used without a connection. Queued
              QC and dispatch work syncs automatically when the internet returns.
            </Text>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.xl },
  brand: { alignItems: 'center', gap: spacing.sm },
  logo: {
    width: 58,
    height: 58,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: '#fff', fontSize: 28, fontWeight: '800' },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  offlineRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  offlineText: { fontSize: 12, fontWeight: '600' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  errorText: { flex: 1, color: colors.danger, fontSize: 12 },
  hint: { fontSize: 11, lineHeight: 17, color: colors.textFaint, textAlign: 'center' },
});
