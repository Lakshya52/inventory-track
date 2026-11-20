import { usePathname, useRouter, type Href } from 'expo-router';
import { Pressable, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontNames } from '@/theme';
import { TabIcon, type TabIconName } from './tab-icons';

type DispatchTab = {
  route: string;
  label: string;
  icon: TabIconName;
};

const DISPATCH_TABS: DispatchTab[] = [
  { route: 'home', label: 'Home', icon: 'home' },
  { route: 'batches', label: 'Batches', icon: 'batches' },
  { route: 'qr-print', label: 'QR Print', icon: 'qr-print' },
  { route: 'dispatch', label: 'Dispatch', icon: 'dispatch' },
  { route: 'loading-tab', label: 'Loading', icon: 'loading' },
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

/** Bottom navigation for the dispatch role. */
export function DispatchTabBar() {
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
        // Figma drop shadow: X 0, Y -7, blur 12.6, spread 0, #000000 @ 25%.
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
        {DISPATCH_TABS.map((tab) => {
          const active = pathname === `/${tab.route}`;

          return (
            <Pressable
              key={tab.route}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
              onPress={() => router.push(`/(dispatch)/${tab.route}` as Href)}
              style={({ pressed }) => [tabStyle, pressed ? { opacity: 0.7 } : undefined]}>
              <View style={[pillStyle, { backgroundColor: active ? colors.navPill : 'transparent' }]}>
                <TabIcon
                  name={tab.icon}
                  color={active ? colors.navActive : colors.navInactive}
                  filled={active}
                />
              </View>
              <Text
                style={[
                  labelStyle,
                  {
                    fontFamily: active ? fontNames.bold : fontNames.medium,
                    color: active ? colors.navActive : colors.navInactive,
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
