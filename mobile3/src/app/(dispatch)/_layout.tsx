import { Tabs } from 'expo-router';

import { DispatchTabBar } from '@/components/navigation/dispatch-tab-bar';
import { RoleGuard } from '@/components/navigation/role-guard';

export default function DispatchLayout() {
  return (
    <RoleGuard role="dispatch">
      <Tabs tabBar={() => <DispatchTabBar />} screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="home" />
        <Tabs.Screen name="batches" />
        <Tabs.Screen name="qr-print" />
        <Tabs.Screen name="dispatch" />
        <Tabs.Screen name="loading-tab" />
        <Tabs.Screen name="orders" options={{ href: null }} />
        <Tabs.Screen name="scan-check" options={{ href: null }} />
        <Tabs.Screen name="reports" options={{ href: null }} />
        <Tabs.Screen name="settings" options={{ href: null }} />
      </Tabs>
    </RoleGuard>
  );
}
