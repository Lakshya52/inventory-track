import { AppHeader } from '@/components/layout/AppHeader';
import { PlaceholderScreen } from '@/components/common/PlaceholderScreen';

export default function BatchSubmittedScreen() {
  return (
    <>
      <AppHeader title="Batch Created" showBack />
      <PlaceholderScreen title="Submitted for QC" description="Confirmation after a batch is submitted." />
    </>
  );
}
