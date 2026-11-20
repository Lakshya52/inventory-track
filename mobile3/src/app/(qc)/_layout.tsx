import { Tabs } from 'expo-router';

import { QCTabBar } from '@/components/navigation/qc-tab-bar';
import { RoleGuard } from '@/components/navigation/role-guard';

export default function QCLayout() {
  return (
    <RoleGuard role="qc">
      <Tabs tabBar={() => <QCTabBar />} screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="home" />
        <Tabs.Screen name="batches" />
        <Tabs.Screen name="scan-check" />
        <Tabs.Screen name="reports" />
        <Tabs.Screen name="settings" />
      </Tabs>
    </RoleGuard>
  );
}
