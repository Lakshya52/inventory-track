import { AppHeader } from '@/components/layout/AppHeader';
import { PlaceholderScreen } from '@/components/common/PlaceholderScreen';

export default function RecallByCameraScreen() {
  return (
    <>
      <AppHeader title="Recall — Scan QR Code" showBack />
      <PlaceholderScreen title="Recall by Camera" description="Camera/QR scanner placeholder. No camera code in this phase." />
    </>
  );
}
