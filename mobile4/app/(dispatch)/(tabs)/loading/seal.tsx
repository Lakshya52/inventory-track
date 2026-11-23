import { AppHeader } from '@/components/layout/AppHeader';
import { PlaceholderScreen } from '@/components/common/PlaceholderScreen';

export default function LoadingSealScreen() {
  return (
    <>
      <AppHeader title="Enter Seal Number" showBack />
      <PlaceholderScreen title="Seal & Finalize" description="Seal number entry before dispatching the vehicle." />
    </>
  );
}
