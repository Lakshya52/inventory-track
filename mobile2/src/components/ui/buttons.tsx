import type { LucideIcon } from 'lucide-react-native';
import { Pressable, View, type PressableProps, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';

import { cx } from '@/lib/cx';
import { AppText } from './app-text';

type ButtonVariant = 'primary' | 'soft' | 'outline';
type ButtonSize = 'md' | 'lg';

type PrimaryButtonProps = PressableProps & {
  label: string;
  icon?: LucideIcon;
  iconSize?: number;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  labelClassName?: string;
  style?: StyleProp<ViewStyle>;       // Added to support native layout/container styles
  labelStyle?: StyleProp<TextStyle>;   // Added to support native typography/color inline styles
};

export function PrimaryButton({
  label,
  icon: Icon,
  iconSize = 18,
  variant = 'primary',
  size = 'lg',
  className,
  labelClassName,
  style,
  labelStyle,
  ...rest
}: PrimaryButtonProps) {
  const container =
    variant === 'primary'
      ? 'bg-navy'
      : variant === 'outline'
        ? 'border border-navy bg-white'
        : 'bg-[#BDE4F6]';

  const textTone = variant === 'primary' ? 'white' : 'navy';
  const iconColor = variant === 'primary' ? '#FFFFFF' : '#001A6E';

  return (
    <Pressable
      accessibilityRole="button"
      className={cx(
        'flex-row items-center justify-center gap-2 rounded-[10px]',
        size === 'lg' ? 'h-[48px]' : 'h-10',
        container,
        rest.disabled && 'opacity-60',
        className,
      )}
      style={({ pressed }) => [
        pressed ? { opacity: 0.86 } : undefined,
        style as ViewStyle, // Combines the press effect with your custom inline styles
      ]}
      {...rest}>
      {Icon ? <Icon size={iconSize} color={iconColor} strokeWidth={2} /> : null}
      <AppText 
        variant="button" 
        tone={textTone} 
        className={cx('text-[14px]', labelClassName)}
        style={labelStyle} // Forwards native inline text styles down to the text engine
      >
        {label}
      </AppText>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  icon: Icon,
  iconSize = 18,
  variant = 'outline', // Defaults to the bordered look out of the box
  size = 'lg',
  className,
  labelClassName,
  style,
  labelStyle,
  ...rest
}: PrimaryButtonProps) {
  const container =
    variant === 'primary'
      ? 'bg-navy'
      : variant === 'outline'
        ? 'border border-navy bg-white'
        : 'bg-[#BDE4F6]';

  const textTone = variant === 'primary' ? 'white' : 'navy';
  const iconColor = variant === 'primary' ? '#FFFFFF' : '#001A6E';

  return (
    <Pressable
      accessibilityRole="button"
      className={cx(
        'flex-row items-center justify-center gap-2 rounded-[10px]',
        size === 'lg' ? 'h-[48px]' : 'h-10',
        container,
        rest.disabled && 'opacity-60',
        className,
      )}
      style={({ pressed }) => [
        pressed ? { opacity: 0.86 } : undefined,
        style as ViewStyle,
      ]}
      {...rest}>
      {Icon ? <Icon size={iconSize} color={iconColor} strokeWidth={2} /> : null}
      <AppText 
        variant="button" 
        tone={textTone} 
        className={cx('text-[14px]', labelClassName)}
        style={labelStyle}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

type IconButtonProps = PressableProps & {
  icon: LucideIcon;
  size?: number;
  className?: string;
  iconColor?: string;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
};

export function IconButton({
  icon: Icon,
  size = 22,
  className,
  iconColor = '#001A6E',
  strokeWidth = 1.9,
  style,
  ...rest
}: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      className={cx('h-10 w-10 items-center justify-center rounded-full', className)}
      style={({ pressed }) => [
        pressed ? { opacity: 0.7 } : undefined,
        style as ViewStyle,
      ]}
      {...rest}>
      <Icon size={size} color={iconColor} strokeWidth={strokeWidth} />
    </Pressable>
  );
}

type IconTileProps = {
  icon: LucideIcon;
  className?: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
};

export function IconTile({ icon: Icon, className, size = 16, color = '#001A6E', strokeWidth = 1.9 }: IconTileProps) {
  return (
    <View className={cx('h-8 w-8 items-center justify-center rounded-[9px]', className)}>
      <Icon size={size} color={color} strokeWidth={strokeWidth} />
    </View>
  );
}
