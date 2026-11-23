import { AppHeader } from '@/components/layout/AppHeader';
import { PlaceholderScreen } from '@/components/common/PlaceholderScreen';

export default function CreateBatchQuantityScreen() {
  return (
    <>
      <AppHeader title="Create a Stock Batch — Step 2: Quantity" showBack />
      <PlaceholderScreen title="Select Quantity" description="Create batch step 2 of 4." />
    </>
  );
}
