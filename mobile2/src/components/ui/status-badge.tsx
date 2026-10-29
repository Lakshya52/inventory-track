import { View } from 'react-native';

import { cx } from '@/lib/cx';

import { AppText } from './app-text';

export type BadgeStatus =
  | 'passed'
  | 'QC_PASSED'
  | 'failed'
  | 'QC_FAILED'
  | 'pending'
  | 'PENDING'
  | 'approved'
  | 'APPROVED'
  | 'DISPATCH_APPROVED'
  | 'rejected'
  | 'REJECTED'
  | 'loading'
  | 'LOADING'
  | 'dispatched'
  | 'CLOSED_DISPATCHED'
  | 'DISPATCHED'
  | 'not_dispatched'
  | 'CLOSED_NOT_DISPATCHED'
  | 'NOT_DISPATCHED'
  | 'order_raised'
  | 'DISPATCH_ORDER_RAISED'
  | string;

function getPalette(status: string): { container: string; text: string } {
  const s = status.toUpperCase();
  if (s === 'PASSED' || s === 'QC_PASSED' || s === 'APPROVED' || s === 'DISPATCH_APPROVED') {
    return { container: 'bg-[#DFF7EA]', text: 'text-[#1E9A5B]' };
  }
  if (s === 'DISPATCHED' || s === 'CLOSED_DISPATCHED') {
    return { container: 'bg-[#E0F2FE]', text: 'text-[#0369A1]' };
  }
  if (s === 'LOADING') {
    return { container: 'bg-[#FEF3C7]', text: 'text-[#B45309]' };
  }
  if (s === 'PENDING' || s === 'DISPATCH_ORDER_RAISED') {
    return { container: 'bg-[#E3E9FF]', text: 'text-[#263A9A]' };
  }
  if (s === 'REJECTED' || s === 'FAILED' || s === 'QC_FAILED' || s === 'NOT_DISPATCHED' || s === 'CLOSED_NOT_DISPATCHED') {
    return { container: 'bg-[#FFE5E7]', text: 'text-[#E34B57]' };
  }
  return { container: 'bg-[#F1F5F9]', text: 'text-[#475569]' };
}

type StatusBadgeProps = {
  status: BadgeStatus;
  label: string;
  className?: string;
};

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const palette = getPalette(status);

  return (
    <View className={cx('rounded-full px-[10px] py-[3px]', palette.container, className)}>
      <AppText variant="tiny" className={cx('text-[10px] font-manrope-bold', palette.text)}>
        {label}
      </AppText>
    </View>
  );
}
