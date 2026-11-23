import { Stack } from 'expo-router';

import { RoleGate } from '@/components/navigation/RoleGate';

export default function DispatchLayout() {
  return (
    <RoleGate allowedRole="DISPATCH">
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="settings" />
      </Stack>
    </RoleGate>
  );
}
