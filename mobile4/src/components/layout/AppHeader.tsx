import { useCallback } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { X, LogOut, Settings as SettingsIcon } from 'lucide-react-native';
import { router } from 'expo-router';
import type { Edge } from 'react-native-safe-area-context';

import { StyledSafeAreaView } from '@/components/common/StyledSafeAreaView';
import { ROLE_DASHBOARD_ROUTE, ROUTES } from '@/constants/routes';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';

import { MoreMenu, type MoreMenuItem } from './MoreMenu';

interface AppHeaderProps {
  title: string;
  showBack?: boolean;
  showMenu?: boolean;
  showSettings?: boolean;
  extraMenuItems?: MoreMenuItem[];
  edges?: Edge[];
}

/**
 * Shared header used by Dispatch screens. `extraMenuItems` lets Admin and QC
 * provide their own menu configuration later without copying navigation code.
 */
export function AppHeader({
  title,
  showBack = false,
  showMenu = true,
  showSettings = true,
  extraMenuItems = [],
  edges = ['top'],
}: AppHeaderProps) {
  const { session, signOut } = useAuth();
  const { tenant, logoUri } = useTenant();

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    // Direct link / no history (common on web): return to the role dashboard.
    router.replace(session ? ROLE_DASHBOARD_ROUTE[session.user.role] : ROUTES.login);
  }, [session]);

  const handleLogout = useCallback(() => {
    void signOut().then(() => router.replace(ROUTES.root));
  }, [signOut]);

  const items: MoreMenuItem[] = [
    ...extraMenuItems,
    ...(showSettings
      ? [
          {
            label: 'Settings',
            icon: <SettingsIcon size={18} color="#14204b" />,
            onPress: () => router.push(ROUTES.dispatch.settings),
          },
        ]
      : []),
    {
      label: 'Logout',
      icon: <LogOut size={18} color="#14204b" />,
      onPress: handleLogout,
    },
  ];

  return (
    <StyledSafeAreaView edges={edges} className="bg-canvas">
      <View className="flex-row items-center gap-2 border-b border-line px-4 py-3">
        {logoUri ? (
          <Image source={{ uri: logoUri }} className="h-8 w-8 rounded-lg" resizeMode="contain" />
        ) : (
          <Image
            source={require('../../../assets/logo.png')}
            className="h-8 w-8"
            resizeMode="contain"
            accessibilityLabel="ProductScanning logo"
          />
        )}
        <Text className="flex-1 text-base font-lexend-semibold text-brand">{title}</Text>
        {showMenu ? <MoreMenu items={items} /> : null}
        {showBack ? (
          <Pressable onPress={handleBack} accessibilityLabel="Go back" className="h-9 w-9 items-center justify-center">
            <X  size={24} color="#14204b" />
          </Pressable>
        ) : null}
      </View>
    </StyledSafeAreaView>
  );
}
