import type { PropsWithChildren } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cx } from '@/lib/cx';

type ScreenProps = PropsWithChildren<{
  className?: string;
  /** Overrides the screen background while keeping the safe-area band. */
  backgroundColor?: string;
  /** Draws the deep navy status-bar band used across the design. */
  showStatusBand?: boolean;
  /** Constrains content on tablets and web. */
  constrain?: boolean;
}>;

export function Screen({
  children,
  className,
  backgroundColor,
  showStatusBand = true,
  constrain = true,
}: ScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className={cx('flex-1 bg-canvas', className)}
      style={backgroundColor ? { backgroundColor } : undefined}>
      {showStatusBand ? (
        <View className="w-full bg-navy" style={{ height: Math.max(insets.top, 8) }} />
      ) : null}
      <View
        className={cx('flex-1', constrain && 'w-full self-center')}
        style={constrain ? { maxWidth: 520 } : undefined}>
        {children}
      </View>
    </View>
  );
}
