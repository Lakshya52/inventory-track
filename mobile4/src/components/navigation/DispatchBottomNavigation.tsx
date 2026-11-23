import { Tabs } from 'expo-router';
import { Box, FileText, House, Printer, Truck } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface DispatchTabConfig {
  name: string;
  title: string;
  Icon: LucideIcon;
}

/**
 * Dispatch-only persistent bottom navigation.
 * Each tab owns a nested stack so pushed work-flow screens keep the tab bar
 * visible and preserve per-tab navigation state.
 */
const DISPATCH_TABS: DispatchTabConfig[] = [
  { name: 'home', title: 'Home', Icon: House },
  { name: 'batches', title: 'Batches', Icon: Box },
  { name: 'qr-print', title: 'QR Print', Icon: Printer },
  { name: 'dispatch', title: 'Dispatch', Icon: FileText },
  { name: 'loading', title: 'Loading', Icon: Truck },
];

export function DispatchBottomNavigation() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#0b8c6f',
        tabBarInactiveTintColor: '#5b6b8c',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopWidth: 1,
          borderTopColor: '#dfe3ee',
          height: 66 + Math.max(insets.bottom, 8),
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 8),
        },
        tabBarItemStyle: { paddingVertical: 2 },
        tabBarIconStyle: { marginBottom: 2 },
        tabBarLabelStyle: { fontSize: 11, fontFamily: 'LexendDeca-SemiBold' },
      }}>
      {DISPATCH_TABS.map(({ name, title, Icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ focused, size }) => (
              <Icon size={size ?? 22} color={focused ? '#0b8c6f' : '#5b6b8c'} strokeWidth={focused ? 2.4 : 1.8} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
