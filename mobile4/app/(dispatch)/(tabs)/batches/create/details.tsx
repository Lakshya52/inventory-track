import { AppHeader } from '@/components/layout/AppHeader';
import { PlaceholderScreen } from '@/components/common/PlaceholderScreen';

export default function CreateBatchDetailsScreen() {
  return (
    <>
      <AppHeader title="Create a Stock Batch — Step 3: Details" showBack />
      <PlaceholderScreen title="Enter Product Details" description="Create batch step 3 of 4." />
    </>
  );
}
