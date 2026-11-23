import { AppHeader } from '@/components/layout/AppHeader';
import { PlaceholderScreen } from '@/components/common/PlaceholderScreen';

export default function LoadingCompleteScreen() {
  return (
    <>
      <AppHeader title="Loading Complete" showBack />
      <PlaceholderScreen title="All Scans Completed" description="Final loading summary before sealing." />
    </>
  );
}
