import type { PropsWithChildren } from 'react';
import { Pressable, Text } from 'react-native';

interface AppButtonProps extends PropsWithChildren {
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

/** Small shared button used by the login/mock-auth screens only. */
export function AppButton({ onPress, variant = 'primary', disabled = false, children }: AppButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`min-h-12 items-center justify-center rounded-xl px-5 py-3 ${
        variant === 'primary' ? 'bg-brand' : 'border border-line bg-canvas'
      } ${disabled ? 'opacity-50' : ''}`}>
      <Text className={`text-base font-lexend-semibold ${variant === 'primary' ? 'text-white' : 'text-brand'}`}>
        {children}
      </Text>
    </Pressable>
  );
}
