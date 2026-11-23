import type { PropsWithChildren } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { StyledSafeAreaView } from './StyledSafeAreaView';

interface ScreenContainerProps extends PropsWithChildren {
  /** Safe-area edges to respect. Pass [] when a parent already handles them. */
  edges?: Edge[];
  scroll?: boolean;
  className?: string;
  /** Shows the pull-to-refresh spinner on the scroll view. */
  refreshing?: boolean;
  /** Enables pull-to-refresh when provided. */
  onRefresh?: () => void;
}

/** Consistent screen shell with safe-area handling and NativeWind styling. */
export function ScreenContainer({
  children,
  edges = ['top', 'left', 'right'],
  scroll = false,
  className = '',
  refreshing = false,
  onRefresh,
}: ScreenContainerProps) {
  const content = scroll ? (
    <ScrollView
      className={`flex-1 bg-canvas ${className}`}
      contentContainerStyle={{ paddingBottom: 24 }}
      alwaysBounceVertical={Boolean(onRefresh)}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#0b218c"
            colors={['#0b218c']}
            progressBackgroundColor="#ffffff"
          />
        ) : undefined
      }>
      {children}
    </ScrollView>
  ) : (
    <View className={`flex-1 bg-canvas ${className}`}>{children}</View>
  );

  return (
    <StyledSafeAreaView edges={edges} className="flex-1 bg-canvas">
      {content}
    </StyledSafeAreaView>
  );
}
