import { View } from 'react-native';

import { cx } from '@/lib/cx';

import { AppText } from './app-text';

export type BadgeStatus = 'passed' | 'failed' | 'pending' | 'approved';

const badgeClasses: Record<BadgeStatus, { container: string; text: string }> = {
  passed: { container: 'bg-[#DFF7EA]', text: 'text-[#1E9A5B]' },
  failed: { container: 'bg-[#FFE5E7]', text: 'text-[#E34B57]' },
  pending: { container: 'bg-[#E3E9FF]', text: 'text-[#263A9A]' },
  approved: { container: 'bg-success-soft', text: 'text-success-text' },
};

type StatusBadgeProps = {
  status: BadgeStatus;
  label: string;
  className?: string;
};

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const palette = badgeClasses[status];

  return (
    <View className={cx('rounded-full px-[10px] py-[3px]', palette.container, className)}>
      <AppText variant="tiny" className={cx('text-[10px]', palette.text)}>
        {label}
      </AppText>
    </View>
  );
}
