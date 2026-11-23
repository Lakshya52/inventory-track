import { AppHeader } from '@/components/layout/AppHeader';
import { PlaceholderScreen } from '@/components/common/PlaceholderScreen';

export default function QrPrintScreen() {
  return (
    <>
      <AppHeader title="QR Codes / Labels" />
      <PlaceholderScreen title="QR Print" description="Select a batch to view and print its QR labels." />
    </>
  );
}
