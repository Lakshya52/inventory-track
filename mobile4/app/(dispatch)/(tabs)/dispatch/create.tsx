import { AppHeader } from '@/components/layout/AppHeader';
import { PlaceholderScreen } from '@/components/common/PlaceholderScreen';

export default function CreateDispatchOrderScreen() {
  return (
    <>
      <AppHeader title="Create Dispatch Order" showBack />
      <PlaceholderScreen title="Create Dispatch Order" description="Client, batches and transporter details." />
    </>
  );
}
