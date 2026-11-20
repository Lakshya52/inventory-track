import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';

type PlaceholderScreenProps = {
  title: string;
};

/** Shared scaffold for role screens until their reference UI is supplied. */
export function PlaceholderScreen({ title }: PlaceholderScreenProps) {
  return (
    <View className="flex-1 items-center justify-center bg-canvas px-8">
      <AppText variant="h2">{title}</AppText>
      <AppText variant="caption" className="mt-2 text-center">
        Screen scaffold ready for the UI design.
      </AppText>
    </View>
  );
}
