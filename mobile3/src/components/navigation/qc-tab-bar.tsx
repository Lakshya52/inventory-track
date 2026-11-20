import { usePathname, useRouter, type Href } from 'expo-router';
import { Pressable, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontNames } from '@/theme';
import { TabIcon, type TabIconName } from './tab-icons';

type QCTab = {
  route: string;
  label: string;
  icon: TabIconName;
};

const QC_TABS: QCTab[] = [
  { route: 'home', label: 'Home', icon: 'home' },
  { route: 'batches', label: 'Batches', icon: 'batches' },
  { route: 'scan-check', label: 'Scan', icon: 'scan' },
  { route: 'reports', label: 'Reports', icon: 'dispatch' },
  { route: 'settings', label: 'Settings', icon: 'settings' },
];

const tabStyle: ViewStyle = { flex: 1, alignItems: 'center' };
const pillStyle: ViewStyle = {
  height: 32,
  width: 58,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 999,
};

const labelStyle: TextStyle = {
  marginTop: 3,
  textAlign: 'center',
  fontSize: 11,
  lineHeight: 16,
};

/**
 * QC bottom navigation scaffold.
 * Replace the styling with the QC reference design when it is supplied.
 */
export function QCTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        width: '100%',
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 8,
        paddingTop: 10,
        boxShadow: [
          {
            offsetX: 0,
            offsetY: -7,
            blurRadius: 12.6,
            spreadDistance: 0,
            color: 'rgba(0, 0, 0, 0.25)',
          },
        ],
        paddingBottom: Math.max(insets.bottom, 10),
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        {QC_TABS.map((tab) => {
          const active = pathname === `/${tab.route}`;

          return (
            <Pressable
              key={tab.route}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
              onPress={() => router.push(`/(qc)/${tab.route}` as Href)}
              style={({ pressed }) => [tabStyle, pressed ? { opacity: 0.7 } : undefined]}>
              <View style={[pillStyle, { backgroundColor: active ? colors.navPill : 'transparent' }]}>
                <TabIcon
                  name={tab.icon}
                  color={active ? colors.brand : colors.navInactive}
                  filled={active}
                />
              </View>
              <Text
                style={[
                  labelStyle,
                  {
                    fontFamily: active ? fontNames.bold : fontNames.medium,
                    color: active ? colors.brand : colors.navInactive,
                  },
                ]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
