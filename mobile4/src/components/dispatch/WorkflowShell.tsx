import type { PropsWithChildren } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { ScreenContainer } from '@/components/common/ScreenContainer';
import { CloseHeader } from '@/components/common/Primitives';

interface WorkflowShellProps extends PropsWithChildren {
  refreshing?: boolean;
  onRefresh?: () => void;
}

/** Shell for workflow screens that use the X close header from the designs. */
export function WorkflowShell({ children, refreshing, onRefresh }: WorkflowShellProps) {
  return (
    <>
      <CloseHeader onClose={() => router.back()} />
      <ScreenContainer edges={[]} scroll refreshing={refreshing} onRefresh={onRefresh}>
        <View className="px-5 pt-2">
          {children}
          <View className="h-28" />
        </View>
      </ScreenContainer>
    </>
  );
}
