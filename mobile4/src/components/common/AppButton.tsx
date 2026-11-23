import type { PropsWithChildren } from 'react';
import { Pressable, Text } from 'react-native';

interface AppButtonProps extends PropsWithChildren {
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'success' | 'danger';
  disabled?: boolean;
  className?: string;
}

/** Shared button. `success` matches the green actions in the designs. */
export function AppButton({
  onPress,
  variant = 'primary',
  disabled = false,
  className = '',
  children,
}: AppButtonProps) {
  const variantClass =
    variant === 'success'
      ? 'bg-[#0ba178]'
      : variant === 'danger'
        ? 'bg-[#d33b4a]'
        : variant === 'primary'
          ? 'bg-brand'
          : 'border border-line bg-canvas';

  const textClass =
    variant === 'secondary' ? 'text-brand' : 'text-white';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`min-h-12 items-center justify-center rounded-xl px-5 py-3 ${variantClass} ${className} ${
        disabled ? 'opacity-50' : ''
      }`}>
      <Text className={`text-base font-lexend-semibold ${textClass}`}>{children}</Text>
    </Pressable>
  );
}
