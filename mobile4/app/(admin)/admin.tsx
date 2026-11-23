import { AppHeader } from '@/components/layout/AppHeader';
import { PlaceholderScreen } from '@/components/common/PlaceholderScreen';

export default function AdminDashboardScreen() {
  return (
    <>
      <AppHeader title="Admin Dashboard" showSettings={false} />
      <PlaceholderScreen
        title="Admin Dashboard"
        description="Admin navigation will be added in a later development phase."
      />
    </>
  );
}
