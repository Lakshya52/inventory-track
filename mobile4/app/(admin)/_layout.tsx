import { Stack } from 'expo-router';

import { RoleGate } from '@/components/navigation/RoleGate';

export default function AdminLayout() {
  return (
    <RoleGate allowedRole="ADMIN">
      <Stack screenOptions={{ headerShown: false }} />
    </RoleGate>
  );
}
