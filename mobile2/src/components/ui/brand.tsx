import { useState } from 'react';
import { View, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EllipsisVertical } from 'lucide-react-native';

import { roleSettingsHref, useRole } from '@/context/role-context';
import { resolveTenantLogoUrl } from '@/services/api';
import { AppText } from './app-text';

export function BrandMark({ size = 50 }: { size?: number }) {
  const { tenant, user } = useRole();
  const logoUrl = resolveTenantLogoUrl(tenant?.logoUrl, tenant?.updatedAt ?? tenant?.id);
  // URL-keyed failure state: a changed logo URL automatically gets a fresh attempt.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showLogo = !!logoUrl && failedUrl !== logoUrl;

  const initial = (tenant?.name?.trim() || user?.company?.trim() || 'K')[0]?.toUpperCase() ?? 'K';

  return (
    <View
      className="items-center justify-center overflow-hidden rounded-[12px] bg-white"
      style={{ width: size, height: size }}>
      {showLogo ? (
        <Image
          source={{ uri: logoUrl }}
          accessibilityLabel={tenant?.name ? `${tenant.name} logo` : 'Organization logo'}
          contentFit="contain"
          transition={120}
          onError={() => setFailedUrl(logoUrl)}
          style={{ width: size - 8, height: size - 8 }}
        />
      ) : (
        <View className="h-9 w-9 items-center justify-center rounded-[8px]">
          <AppText
            className="text-[14px] leading-[11px] text-[#0BAED6]"
            style={{ fontFamily: 'Manrope_800ExtraBold' }}>
            {initial}
          </AppText>
        </View>
      )}
    </View>
  );
}

export function BrandHeader() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, role, tenant } = useRole();

  const companyName = tenant?.name?.trim() || user?.company?.trim() || 'KLJ Polymers & Chemicals Limited';

  return (
    <View
      className="bg-navy px-5 py-[38px]"
      style={{ paddingTop: Math.max(insets.top, 12) + 8 }}>
      <View className="flex-row items-center gap-3 mt-10">
        <BrandMark />
        <AppText
          numberOfLines={2}
          className="flex-1 text-[16px] leading-[22px] text-white"
          style={{ fontFamily: 'Manrope_500Medium' }}>
          {companyName}
        </AppText>
        {user?.role && (
          <AppText
            accessibilityLabel={`User role: ${user.role}`}
            className="text-[14px] leading-[18px] text-(--color-primary) bg-white px-2 py-1 rounded-full ml-auto mt-auto shrink-0"
            style={{ fontFamily: 'Manrope_500Medium' }}>
            {user.role.toUpperCase()}
          </AppText>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          onPress={() => router.push(roleSettingsHref[role])}
          className="h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15">
          <EllipsisVertical size={17} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}
