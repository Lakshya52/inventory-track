import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthContext';
import { colors } from '../../theme';

export default function TabsLayout() {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, 8);

  if (!session) return null;

  const role = session.user.role;
  const visible = (route: string): boolean => {
    if (role === 'ADMIN') return ['index', 'orders', 'manage', 'reports', 'more'].includes(route);
    if (role === 'QC') return ['index', 'batches', 'scan', 'history', 'more'].includes(route);
    return ['index', 'scan', 'orders', 'history', 'more'].includes(route);
  };
  const tabOptions = (route: string, title: string, icon: string, selectedIcon: string) => ({
    href: visible(route) ? undefined : null,
    title,
    tabBarIcon: ({ color, size, focused }: { color: any; size: number; focused: boolean }) => (
      <Ionicons name={(focused ? selectedIcon : icon) as any} size={route === 'scan' ? size + 3 : size} color={color || colors.textFaint} />
    ),
  });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingTop: 8,
          paddingBottom: bottomPadding,
          height: 60 + bottomPadding,
        },
        tabBarBadgeStyle: {
          backgroundColor: colors.danger,
          color: '#fff',
          fontSize: 9,
          minWidth: 17,
          height: 17,
          lineHeight: 17,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={tabOptions('index', 'Home', 'home-outline', 'home')}
      />
      <Tabs.Screen
        name="batches"
        options={tabOptions('batches', 'Batches', 'albums-outline', 'albums')}
      />
      <Tabs.Screen
        name="scan"
        options={tabOptions('scan', 'Scan', 'qr-code-outline', 'qr-code')}
      />
      <Tabs.Screen
        name="history"
        options={tabOptions('history', 'History', 'time-outline', 'time')}
      />
      <Tabs.Screen
        name="sync"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen name="products" options={{ href: null }} />
      <Tabs.Screen name="qr-lookup" options={{ href: null }} />
      <Tabs.Screen
        name="profile"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen name="orders" options={tabOptions('orders', 'Orders', 'clipboard-outline', 'clipboard')} />
      <Tabs.Screen name="manage" options={tabOptions('manage', 'Manage', 'grid-outline', 'grid')} />
      <Tabs.Screen name="reports" options={tabOptions('reports', 'Reports', 'bar-chart-outline', 'bar-chart')} />
      <Tabs.Screen name="more" options={tabOptions('more', 'More', 'ellipsis-horizontal-circle-outline', 'ellipsis-horizontal-circle')} />
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="production" options={{ href: null }} />
      <Tabs.Screen name="qr-jobs" options={{ href: null }} />
      <Tabs.Screen name="manage/[section]" options={{ href: null }} />
    </Tabs>
  );
}
