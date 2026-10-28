import { View } from 'react-native';

import { PageHeading } from '@/components/ui/page';
import { Screen } from '@/components/ui/screen';
import { ScannerCard } from '@/components/ui/scanner';

export function ScanTabScreen() {
  return (
    <Screen>
      <View className="flex-1 px-5 pt-6">
        <PageHeading
          title="Scan & View Details"
          subtitle="Scan any QR code that is already printed and pasted on a product."
        />
        <ScannerCard className="mt-6" bottomPadding={24} />
      </View>
    </Screen>
  );
}
