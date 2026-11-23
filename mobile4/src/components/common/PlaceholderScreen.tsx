import { Text, View } from 'react-native';

import { ScreenContainer } from './ScreenContainer';

interface PlaceholderScreenProps {
  title: string;
  description?: string;
}

/** Minimal screen used until the user implements the final NativeWind designs. */
export function PlaceholderScreen({ title, description }: PlaceholderScreenProps) {
  return (
    <ScreenContainer edges={[]}>
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-xl font-lexend-bold text-ink">{title}</Text>
        {description ? <Text className="mt-2 text-center text-sm font-lexend text-muted">{description}</Text> : null}
      </View>
    </ScreenContainer>
  );
}
