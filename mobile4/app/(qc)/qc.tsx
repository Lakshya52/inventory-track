import { AppHeader } from '@/components/layout/AppHeader';
import { PlaceholderScreen } from '@/components/common/PlaceholderScreen';

export default function QcDashboardScreen() {
  return (
    <>
      <AppHeader title="QC Dashboard" showSettings={false} />
      <PlaceholderScreen
        title="QC Dashboard"
        description="QC navigation will be added in a later development phase."
      />
    </>
  );
}
