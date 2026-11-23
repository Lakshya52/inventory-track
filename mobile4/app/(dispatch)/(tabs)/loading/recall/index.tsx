import { AppHeader } from '@/components/layout/AppHeader';
import { PlaceholderScreen } from '@/components/common/PlaceholderScreen';

export default function LoadingRecallScreen() {
  return (
    <>
      <AppHeader title="Recall a Product" showBack />
      <PlaceholderScreen title="Recall" description="Choose typing a QR value or scanning a QR code." />
    </>
  );
}
