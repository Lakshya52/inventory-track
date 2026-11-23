import { AppHeader } from '@/components/layout/AppHeader';
import { PlaceholderScreen } from '@/components/common/PlaceholderScreen';

export default function LoadingScanScreen() {
  return (
    <>
      <AppHeader title="Scanning Order" showBack />
      <PlaceholderScreen title="Scan" description="Scan/Recall workflow — scanning step." />
    </>
  );
}
