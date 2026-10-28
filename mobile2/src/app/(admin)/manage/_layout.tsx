import { Stack } from 'expo-router';

import { colors } from '@/theme';

export default function ManageLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
