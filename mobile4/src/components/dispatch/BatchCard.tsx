import { Pressable, Text, View } from 'react-native';
import { ArrowRight } from 'lucide-react-native';

import { StatusPill } from '@/components/common/Primitives';

export interface BatchCardProps {
  id: string;
  products: string;
  meta: string;
  count: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function BatchCard({
  id,
  products,
  meta,
  count,
  actionLabel = 'View batch',
  onAction,
}: BatchCardProps) {
  return (
    <View className="rounded-2xl border border-[#e6e9f2] bg-canvas p-4 shadow-sm">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-lexend text-muted">{id}</Text>
        <StatusPill>{count}</StatusPill>
      </View>
      <Text className="mt-2 text-sm font-lexend-semibold leading-5 text-ink">{products}</Text>
      <Text className="mt-2 text-xs font-lexend text-muted">{meta}</Text>
      <Pressable onPress={onAction} className="mt-3 flex-row items-center justify-end gap-1">
        <Text className="text-xs font-lexend-semibold text-[#0b8c6f]">{actionLabel}</Text>
        <ArrowRight size={14} color="#0b8c6f" />
      </Pressable>
    </View>
  );
}
