import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { cx } from '@/lib/cx';
import { pastelClasses, type PastelTone } from '@/theme/pastel';

import { AppText } from './app-text';
import { IconTile } from './buttons';

type QuickLinkProps = {
  icon: LucideIcon;
  label: string;
  tone: PastelTone;
  onPress: () => void;
};

export function QuickLink({ icon, label, tone, onPress }: QuickLinkProps) {
  const palette = pastelClasses[tone];

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={cx(
        'h-[43px] flex-1 flex-row items-center gap-[6px] rounded-[8px] border px-[6px]',
        palette.container,
        palette.border,
      )}
      style={({ pressed }) => (pressed ? { opacity: 0.78 } : undefined)}>
      <IconTile
        icon={icon}
        className={cx('h-[26px] w-[26px] rounded-[6px]', palette.icon)}
        size={13}
      />
      <AppText variant="label" className="flex-1 text-[10px]" numberOfLines={1}>
        {label}
      </AppText>
      <ChevronRight size={12} color="#011A87" strokeWidth={2.2} />
    </Pressable>
  );
}

type ManagementTileProps = {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  tone: PastelTone;
  onPress: () => void;
};

export function ManagementTile({ icon, title, subtitle, tone, onPress }: ManagementTileProps) {
  const palette = pastelClasses[tone];

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={cx(
        'min-h-[177px] flex-1 rounded-[14px] border p-5',
        palette.container,
        palette.border,
      )}
      style={({ pressed }) => (pressed ? { opacity: 0.8 } : undefined)}>
      <IconTile
        icon={icon}
        className={cx('h-10 w-10 rounded-[10px]', palette.icon)}
        size={20}
      />
      <AppText variant="h3" className="mt-[18px] text-[18px] leading-[24px]">
        {title}
      </AppText>
      <View className="mt-[6px] flex-1">
        <AppText variant="body" className="text-[14px] leading-[20px]">
          {subtitle}
        </AppText>
      </View>
    </Pressable>
  );
}
