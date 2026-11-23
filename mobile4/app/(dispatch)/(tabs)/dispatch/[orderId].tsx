import { useLocalSearchParams } from 'expo-router';

import { DispatchOrderDetails } from '@/components/dispatch/DispatchOrderDetails';

export default function DispatchOrderDetailsScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  return <DispatchOrderDetails orderId={orderId} />;
}
