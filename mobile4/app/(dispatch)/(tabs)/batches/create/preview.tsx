import { AppHeader } from '@/components/layout/AppHeader';
import { PlaceholderScreen } from '@/components/common/PlaceholderScreen';

export default function CreateBatchPreviewScreen() {
  return (
    <>
      <AppHeader title="Create a Stock Batch — Step 4: Preview" showBack />
      <PlaceholderScreen title="Preview Batch" description="Create batch step 4 of 4." />
    </>
  );
}
