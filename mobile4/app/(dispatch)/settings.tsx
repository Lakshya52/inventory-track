import { AppHeader } from '@/components/layout/AppHeader';
import { PlaceholderScreen } from '@/components/common/PlaceholderScreen';

export default function SettingsScreen() {
  return (
    <>
      <AppHeader title="Settings" showBack showMenu={false} />
      <PlaceholderScreen title="Settings" description="Dispatch settings will be implemented later." />
    </>
  );
}
