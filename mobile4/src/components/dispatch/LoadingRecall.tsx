import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { ScanLine, Type } from 'lucide-react-native';

import { ScreenTitle, TabSwitcher } from '@/components/common/Primitives';
import { WorkflowShell } from './WorkflowShell';

export function LoadingRecall() {
  return (
    <WorkflowShell>
      <TabSwitcher active="recall" onScan={() => router.push('/loading/scan')} onRecall={() => {}} />

      <View className="mt-6">
        <ScreenTitle>Recall A Product</ScreenTitle>
        <Text className="mt-2 text-sm font-lexend text-[#9aa1b4]">
          Enter QR code value or Scan a QR code to make the recall of the product
        </Text>
      </View>

      <View className="mt-8 flex-row gap-3">
        <Pressable
          onPress={() => router.push('/loading/recall/type')}
          className="h-32 flex-1 items-center justify-center gap-3 rounded-xl border border-[#8f9bc8]">
          <Type size={24} color="#5b6b8c" />
          <Text className="text-sm font-lexend-semibold text-brand">Type QR CODE</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/loading/recall/camera')}
          className="h-32 flex-1 items-center justify-center gap-3 rounded-xl border border-[#8f9bc8]">
          <ScanLine size={24} color="#5b6b8c" />
          <Text className="text-sm font-lexend-semibold text-brand">Scan QR CODE</Text>
        </Pressable>
      </View>

      <Text className="mt-6 text-sm font-lexend leading-5 text-[#9aa1b4]">
        Use this if an item is damaged or cannot be loaded. Recalled QR codes are excluded from the loading count.
      </Text>
    </WorkflowShell>
  );
}
