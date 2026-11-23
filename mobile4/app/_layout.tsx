import '../global.css';

import { getLoadedFonts, useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppErrorBoundary } from '@/components/common/AppErrorBoundary';
import { ROLE_DASHBOARD_ROUTE, ROUTES } from '@/constants/routes';
import { AppDataProvider } from '@/contexts/AppDataContext';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { BatchCreationProvider } from '@/contexts/BatchCreationContext';
import { LoadingProvider } from '@/contexts/LoadingContext';
import { TenantProvider } from '@/contexts/TenantContext';

// NativeWind generates the font utilities correctly, but to guarantee the
// family on native (regardless of class compilation), set the loaded family as
// the global default for Text and TextInput. Weight-specific classes still
// override this with the Medium/SemiBold/Bold files.
const TextWithDefaults = Text as unknown as { defaultProps: { style?: unknown } };
TextWithDefaults.defaultProps = TextWithDefaults.defaultProps ?? {};
TextWithDefaults.defaultProps.style = [{ fontFamily: 'LexendDeca-Regular' }];

const TextInputWithDefaults = TextInput as unknown as { defaultProps: { style?: unknown } };
TextInputWithDefaults.defaultProps = TextInputWithDefaults.defaultProps ?? {};
TextInputWithDefaults.defaultProps.style = [{ fontFamily: 'LexendDeca-Regular' }];

function AppLoading() {
  return (
    <View className="flex-1 items-center justify-center bg-canvas">
      <ActivityIndicator color="#0b218c" />
      <Text className="mt-4 text-sm font-lexend text-muted">Loading…</Text>
    </View>
  );
}

function RootNavigator() {
  const { session, isLoading } = useAuth();
  console.log('[mobile4] navigator render, loading:', isLoading, 'role:', session?.user.role ?? null);

  if (isLoading) return <AppLoading />;

  // Wrong-role and unauthenticated attempts are redirected to the caller's own
  // dashboard (or login), never to the protected group's internal anchor.
  const redirectTo = session ? ROLE_DASHBOARD_ROUTE[session.user.role] : ROUTES.login;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Must be declared first: on native the Stack starts at its first child.
          index redirects to the correct dashboard/login for the current role. */}
      <Stack.Screen name="index" />
      {/* Role-aware protection is centralized here. A wrong role cannot open
          another role's group, even through a manually entered deep link. */}
      <Stack.Protected guard={session?.user.role === 'ADMIN'} redirectTo={redirectTo}>
        <Stack.Screen name="(admin)" />
      </Stack.Protected>
      <Stack.Protected guard={session?.user.role === 'QC'} redirectTo={redirectTo}>
        <Stack.Screen name="(qc)" />
      </Stack.Protected>
      <Stack.Protected guard={session?.user.role === 'DISPATCH'} redirectTo={redirectTo}>
        <Stack.Screen name="(dispatch)" />
      </Stack.Protected>
      <Stack.Protected guard={!session} redirectTo={redirectTo}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

function AuthenticatedProviders() {
  const { session, isLoading } = useAuth();

  if (isLoading) return <AppLoading />;
  if (!session) return <RootNavigator />;

  return (
    <AppDataProvider>
      <BatchCreationProvider>
        <LoadingProvider>
          <RootNavigator />
        </LoadingProvider>
      </BatchCreationProvider>
    </AppDataProvider>
  );
}

export default function RootLayout() {
  console.log('[mobile4] root layout loaded');
  // Keys are the exact PostScript names of the bundled font files, so iOS
  // resolves them correctly and Android matches the same family names.
  const [fontsLoaded, fontError] = useFonts({
    'LexendDeca-Regular': require('@/fonts/LexendDeca-Regular.ttf'),
    'LexendDeca-Medium': require('@/fonts/LexendDeca-Medium.ttf'),
    'LexendDeca-SemiBold': require('@/fonts/LexendDeca-SemiBold.ttf'),
    'LexendDeca-Bold': require('@/fonts/LexendDeca-Bold.ttf'),
  });

  console.log(
    '[mobile4] fonts:',
    fontsLoaded ? 'loaded' : 'pending',
    fontError ? `error=${fontError.message}` : 'no error',
    'native=',
    typeof document === 'undefined' ? getLoadedFonts().join(',') : 'web',
  );

  if (!fontsLoaded && !fontError) return <AppLoading />;

  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <AuthProvider>
          <TenantProvider>
            <StatusBar style="dark" />
            <AuthenticatedProviders />
          </TenantProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}
