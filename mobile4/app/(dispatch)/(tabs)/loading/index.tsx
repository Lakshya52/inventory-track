import { AppHeader } from '@/components/layout/AppHeader';
import { PlaceholderScreen } from '@/components/common/PlaceholderScreen';

export default function LoadingScreen() {
  return (
    <>
      <AppHeader title="Loading & Scanning" />
      <PlaceholderScreen title="Loading & Scan" description="Start loading from a ready dispatch order." />
    </>
  );
}
