import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { cx } from '@/lib/cx';
import { pastelClasses, type PastelTone } from '@/theme/pastel';

import { AppText } from './app-text';
import { IconTile } from './buttons';

type StatCardProps = {
  icon: LucideIcon;
  value: string;
  label: string;
  tone: PastelTone;
  className?: string;
};

export function StatCard({ icon, value, label, tone, className }: StatCardProps) {
  const palette = pastelClasses[tone];

  return (
    <View
      className={cx(
        'min-h-[139px] rounded-[12px] border p-[13px]',
        palette.container,
        palette.border,
        className,
      )}>
      <IconTile
        icon={icon}
        className={cx('h-7 w-7 rounded-[7px]', palette.icon)}
        size={15}
      />
      <AppText
        className="mt-[13px] text-[34px] leading-[40px] text-navy"
        style={{ fontFamily: 'Manrope_700Bold' }}>
        {value}
      </AppText>
      <AppText variant="caption" className="mt-0.5 text-[11px]">
        {label}
      </AppText>
    </View>
  );
}
