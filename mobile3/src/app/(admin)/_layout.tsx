import { Tabs } from 'expo-router';

import { AdminTabBar } from '@/components/navigation/admin-tab-bar';
import { RoleGuard } from '@/components/navigation/role-guard';

export default function AdminLayout() {
  return (
    <RoleGuard role="admin">
      <Tabs tabBar={() => <AdminTabBar />} screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="home" />
        <Tabs.Screen name="reports" />
        <Tabs.Screen name="dispatches" />
        <Tabs.Screen name="settings" />
      </Tabs>
    </RoleGuard>
  );
}
