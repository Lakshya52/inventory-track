import { useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { CircleCheck } from 'lucide-react-native';

import { ScreenTitle } from '@/components/common/Primitives';
import { useBatchCreation } from '@/contexts/BatchCreationContext';
import { domainApi } from '@/services/domain';
import { WorkflowShell } from './WorkflowShell';
import { BatchStepper } from './BatchStepper';
import { StepActions } from './StepActions';

export function CreateBatchPreview() {
  const { items, toPayload, setLastCreated } = useBatchCreation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await domainApi.createBatch(toPayload());
      setLastCreated(response);
      router.push('/batches/submitted');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to create batch.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <WorkflowShell>
      <ScreenTitle>Create a Stock Batch</ScreenTitle>
      <BatchStepper active={4} />

      <View className="mt-8 items-center">
        <View className="h-20 w-20 items-center justify-center rounded-full bg-[#d9f3e8]">
          <CircleCheck size={44} color="#0ba178" />
        </View>
        <Text className="mt-4 text-lg font-lexend-bold text-brand">Review Batch</Text>
        <Text className="mt-1 text-xs font-lexend text-muted">{items.length} product(s) selected</Text>
      </View>

      <View className="mt-6 overflow-hidden rounded-2xl border border-[#e6e9f2] bg-canvas">
        <View className="border-b border-[#e6e9f2] bg-[#f7f8fd] px-4 py-3">
          <Text className="text-xs font-lexend-semibold text-ink">Products In This Batch</Text>
        </View>
        {items.map((item) => (
          <View key={item.product.id} className="border-b border-[#e6e9f2] px-4 py-3 last:border-b-0">
            <View className="flex-row items-center gap-2">
              <Text className="text-sm font-lexend-semibold text-brand">{item.product.grade || item.product.name}</Text>
              <View className="rounded bg-[#0ba178] px-1.5 py-0.5">
                <Text className="text-[8px] font-lexend-semibold text-white">{item.product.name}</Text>
              </View>
            </View>
            <Text className="mt-1 text-[10px] font-lexend text-muted">
              {item.quantity} bags × {item.packageQuantity} Kg
            </Text>
            <Text className="text-[10px] font-lexend text-muted">SKU : {item.product.sku}</Text>
            <Text className="text-[10px] font-lexend text-muted">
              MFD: {item.manufacturingDate}, EXP: {item.expiryDate}
            </Text>
            <Text className="text-[10px] font-lexend text-muted">Location: {item.shelfLocationId ?? '-'}</Text>
          </View>
        ))}
      </View>

      {busy ? <ActivityIndicator className="mt-4" color="#0b218c" /> : null}
      {error ? <Text className="mt-3 text-center text-sm text-red-600">{error}</Text> : null}

      <StepActions
        onPrevious={() => router.push('/batches/create/details')}
        onNext={submit}
        nextLabel="Submit"
        nextDisabled={busy || items.length === 0}
      />
    </WorkflowShell>
  );
}
