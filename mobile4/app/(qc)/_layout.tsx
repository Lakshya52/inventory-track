import { Stack } from 'expo-router';

import { RoleGate } from '@/components/navigation/RoleGate';

export default function QcLayout() {
  return (
    <RoleGate allowedRole="QC">
      <Stack screenOptions={{ headerShown: false }} />
    </RoleGate>
  );
}
