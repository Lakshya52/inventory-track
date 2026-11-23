import { useEffect } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';

import { ROLE_DASHBOARD_ROUTE, ROUTES } from '@/constants/routes';
import { useAuth } from '@/contexts/AuthContext';

/** Entry route: sends each authenticated user to their own dashboard. */
export default function Index() {
  const { session, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    const destination = session ? ROLE_DASHBOARD_ROUTE[session.user.role] : ROUTES.login;
    console.log('[mobile4] index redirecting to:', destination);
    router.replace(destination);
  }, [isLoading, session]);

  return (
    <View className="flex-1 items-center justify-center bg-canvas">
      <ActivityIndicator color="#0b218c" />
      <Text className="mt-4 text-sm font-lexend text-muted">Opening…</Text>
    </View>
  );
}
