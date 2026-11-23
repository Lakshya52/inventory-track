import { AppHeader } from '@/components/layout/AppHeader';
import { PlaceholderScreen } from '@/components/common/PlaceholderScreen';

export default function CreateBatchSelectScreen() {
  return (
    <>
      <AppHeader title="Create a Stock Batch — Step 1: Select" showBack />
      <PlaceholderScreen title="Select Products" description="Create batch step 1 of 4." />
    </>
  );
}
