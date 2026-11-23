import { View, Text } from 'react-native';
import { router } from 'expo-router';

import { QrScanner } from '@/components/common/QrScanner';
import { ScreenTitle, TabSwitcher } from '@/components/common/Primitives';
import { WorkflowShell } from './WorkflowShell';

export function LoadingRecallCamera() {
  return (
    <WorkflowShell>
      <TabSwitcher active="recall" onScan={() => router.push('/loading/scan')} onRecall={() => router.push('/loading/recall')} />
      <View className="mt-6">
        <ScreenTitle>Recall A Product</ScreenTitle>
        <Text className="mt-2 text-sm font-lexend text-[#9aa1b4]">
          Scan a QR code to make the recall of the product
        </Text>
      </View>

      <QrScanner
        label="Scanned QR value"
        onScan={(value) => router.push(`/loading/recall/type?qr=${encodeURIComponent(value)}`)}
      />
    </WorkflowShell>
  );
}
