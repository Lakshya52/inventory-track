import { Tabs } from 'expo-router/js-tabs';

import { ADMIN_TABS } from '@/components/navigation/tabs';
import { RoleGuard } from '@/components/navigation/role-guard';
import { RoleTabBar } from '@/components/navigation/role-tab-bar';

export default function AdminLayout() {
  return (
    <RoleGuard role="admin">
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <RoleTabBar {...props} items={ADMIN_TABS} />}>
        <Tabs.Screen name="home" />
        <Tabs.Screen name="reports" />
        <Tabs.Screen name="dispatches" />
        {/* Pop the Management sub-pages when navigating away from the tab. */}
        <Tabs.Screen name="manage" options={{ popToTopOnBlur: true }} />
        <Tabs.Screen name="settings" />
      </Tabs>
    </RoleGuard>
  );
}
