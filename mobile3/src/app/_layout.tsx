import '../global.css';

import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RoleProvider } from '@/context/role-context';
import { colors } from '@/theme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    LexendDeca_400Regular: require('../../assets/fonts/LexendDeca-Regular.ttf'),
    LexendDeca_500Medium: require('../../assets/fonts/LexendDeca-Medium.ttf'),
    LexendDeca_600SemiBold: require('../../assets/fonts/LexendDeca-SemiBold.ttf'),
    LexendDeca_700Bold: require('../../assets/fonts/LexendDeca-Bold.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <RoleProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="(admin)" />
          <Stack.Screen name="(qc)" />
          <Stack.Screen name="(dispatch)" />
        </Stack>
      </RoleProvider>
    </SafeAreaProvider>
  );
}
