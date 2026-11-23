import { AppHeader } from '@/components/layout/AppHeader';
import { PlaceholderScreen } from '@/components/common/PlaceholderScreen';

export default function RecallByTextScreen() {
  return (
    <>
      <AppHeader title="Recall — Type QR Code" showBack />
      <PlaceholderScreen title="Recall by Text" description="Enter product QR code, condition and reason." />
    </>
  );
}
