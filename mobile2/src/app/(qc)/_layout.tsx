import { Tabs } from 'expo-router/js-tabs';

import { QC_TABS } from '@/components/navigation/tabs';
import { RoleGuard } from '@/components/navigation/role-guard';
import { RoleTabBar } from '@/components/navigation/role-tab-bar';

export default function QCLayout() {
  return (
    <RoleGuard role="qc">
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <RoleTabBar {...props} items={QC_TABS} />}>
        <Tabs.Screen name="home" />
        <Tabs.Screen name="batches" />
        <Tabs.Screen name="scan-check" />
        <Tabs.Screen name="reports" />
        <Tabs.Screen name="settings" />
      </Tabs>
    </RoleGuard>
  );
}
