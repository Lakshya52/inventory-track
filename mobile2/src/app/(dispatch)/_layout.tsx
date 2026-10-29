import { Tabs } from 'expo-router/js-tabs';

import { DISPATCH_TABS } from '@/components/navigation/tabs';
import { RoleGuard } from '@/components/navigation/role-guard';
import { RoleTabBar } from '@/components/navigation/role-tab-bar';

export default function DispatchLayout() {
  return (
    <RoleGuard role="dispatch">
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <RoleTabBar {...props} items={DISPATCH_TABS} />}>
        <Tabs.Screen name="home" />
        <Tabs.Screen name="orders" />
        <Tabs.Screen name="scan-check" />
        <Tabs.Screen name="history" />
        <Tabs.Screen name="settings" />
      </Tabs>
    </RoleGuard>
  );
}
