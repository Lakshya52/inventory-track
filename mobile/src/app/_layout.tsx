import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { SyncProvider } from '../sync/SyncContext';
import { initDatabase } from '../db/database';
import { Button, LoadingView, Screen } from '../components/ui';
import { colors, radius, spacing } from '../theme';
import { useFonts, Inter_400Regular } from '@expo-google-fonts/inter';

type BootstrapState = 'loading' | 'ready' | 'error';

function DatabaseGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<BootstrapState>('loading');
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      await initDatabase();
      setState('ready');
    } catch (err: any) {
      setError(err?.message || 'The local database could not be opened.');
      setState('error');
    }
  }, []);

  // Load Inter font before rendering the app
  const [fontsLoaded] = useFonts({ Inter_400Regular });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- open the local database once after mount
    void start();
  }, [start]);

  if (!fontsLoaded) {
    return (
      <Screen edges={['top', 'bottom']}>
        <LoadingView label="Loading fonts..." />
      </Screen>
    );
  }

  if (state === 'loading') {
    return (
      <Screen edges={['top', 'bottom']}>
        <LoadingView label="Preparing offline data..." />
      </Screen>
    );
  }

  if (state === 'error') {
    return (
      <Screen edges={['top', 'bottom']} style={styles.errorScreen}>
        <View style={styles.errorIcon}>
          <Text style={styles.errorIconText}>!</Text>
        </View>
        <Text style={styles.errorTitle}>Local storage is unavailable</Text>
        <Text style={styles.errorText}>{error}</Text>
        <Text style={styles.errorHint}>
          Close any other copy of the app, then try again. Your queued field work is not affected.
        </Text>
        <Button title="Try again" onPress={() => void start()} />
      </Screen>
    );
  }

  return <>{children}</>;
}

function RootNavigator() {
  const { session, initializing } = useAuth();

  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="qr-lookup" options={{ headerShown: true, title: 'QR product checker' }} />
          <Stack.Screen name="products" options={{ headerShown: true, title: 'Products' }} />
          <Stack.Screen name="production" options={{ headerShown: true, title: 'Production' }} />
          <Stack.Screen name="qr-jobs" options={{ headerShown: true, title: 'QR label jobs' }} />
          <Stack.Screen name="profile" options={{ headerShown: true, title: 'Profile' }} />
          <Stack.Screen name="settings" options={{ headerShown: true, title: 'Settings' }} />
          <Stack.Screen name="sync" options={{ headerShown: true, title: 'Sync center' }} />
          <Stack.Screen name="manage/[section]" options={{ headerShown: true, title: 'Inventory setup' }} />
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
      {initializing ? (
        <View style={[StyleSheet.absoluteFill, styles.loadingOverlay]}>
          <LoadingView label="Restoring your session..." />
        </View>
      ) : null}
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <DatabaseGate>
        <AuthProvider>
          <SyncProvider>
            <RootNavigator />
            <StatusBar style="dark" />
          </SyncProvider>
        </AuthProvider>
      </DatabaseGate>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingOverlay: {
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  errorScreen: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  errorIcon: {
    width: 54,
    height: 54,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dangerSoft,
  },
  errorIconText: { fontSize: 26, fontWeight: '800', color: colors.danger },
  errorTitle: { fontSize: 18, fontWeight: '800', color: colors.text, textAlign: 'center' },
  errorText: { fontSize: 12, color: colors.danger, textAlign: 'center', lineHeight: 18 },
  errorHint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
});
