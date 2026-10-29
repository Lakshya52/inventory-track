import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRole } from '@/context/role-context';
import { AppText } from './app-text';

export function BrandMark({ size = 50 }: { size?: number }) {
  return (
    <View
      className="items-center justify-center rounded-[12px] bg-white"
      style={{ width: size, height: size }}>
      <View className="h-9 w-9 items-center justify-center rounded-[8px]">
        <AppText
          className="text-[14px] leading-[11px] text-[#0BAED6]"
          style={{ fontFamily: 'Manrope_800ExtraBold' }}>
          K
        </AppText>
      </View>
    </View>
  );
}

export function BrandHeader() {
  const insets = useSafeAreaInsets();
  const { user } = useRole();

  return (
    <View
      className="bg-navy px-5 py-[38px]"
      style={{ paddingTop: Math.max(insets.top, 12) + 8 }}>
      <View className="flex-row items-center gap-3 mt-10">
        <BrandMark />
        <AppText
          className="text-[16px] leading-[22px] text-white"
          style={{ fontFamily: 'Manrope_500Medium' }}>
          KLJ Polymers &{'\n'}Chemicals Limited
        </AppText>
        {user?.role && (
          <AppText
            accessibilityLabel={`User role: ${user.role}`}
            className="text-[14px] leading-[18px] text-(--color-primary) bg-white px-2 py-1 rounded-full ml-auto mt-auto shrink-0"
            style={{ fontFamily: 'Manrope_500Medium' }}>
            {user.role.toUpperCase()}
          </AppText>
        )}
      </View>
    </View>
  );
}
