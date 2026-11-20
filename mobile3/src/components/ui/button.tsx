import { Pressable, type PressableProps } from 'react-native';

import { cx } from '@/lib/cx';
import { colors } from '@/theme';
import { AppText } from './app-text';

type PrimaryButtonProps = PressableProps & {
  label: string;
  className?: string;
  labelClassName?: string;
};

export function PrimaryButton({
  label,
  className,
  labelClassName,
  disabled,
  ...rest
}: PrimaryButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      className={cx(
        'h-[48px] items-center justify-center rounded-[6px] bg-brand',
        disabled && 'opacity-60',
        className,
      )}
      style={({ pressed }) => (pressed && !disabled ? { backgroundColor: colors.brandPressed } : undefined)}
      {...rest}>
      <AppText variant="button" className={cx('text-white', labelClassName)}>
        {label}
      </AppText>
    </Pressable>
  );
}
