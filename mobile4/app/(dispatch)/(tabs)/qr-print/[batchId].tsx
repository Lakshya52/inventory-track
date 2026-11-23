import { useLocalSearchParams } from 'expo-router';

import { AppHeader } from '@/components/layout/AppHeader';
import { PlaceholderScreen } from '@/components/common/PlaceholderScreen';

/** One route covers all four QC states identified in the designs. */
export default function BatchQrDetailsScreen() {
  const { batchId } = useLocalSearchParams<{ batchId: string }>();

  return (
    <>
      <AppHeader title="Batch QR Details" showBack />
      <PlaceholderScreen
        title="Batch QR Details"
        description={`QR details for batch ${batchId}. QC state variants are handled by this screen later.`}
      />
    </>
  );
}
