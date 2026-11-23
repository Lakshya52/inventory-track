import { useLocalSearchParams } from 'expo-router';

import { AppHeader } from '@/components/layout/AppHeader';
import { PlaceholderScreen } from '@/components/common/PlaceholderScreen';

export default function DispatchOrderDetailsScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();

  return (
    <>
      <AppHeader title="Order Details" showBack />
      <PlaceholderScreen title={`Order ${orderId}`} description="Order details and packing list will appear here." />
    </>
  );
}
