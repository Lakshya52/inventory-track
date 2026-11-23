import { View, Text, TextInput } from 'react-native';
import { router } from 'expo-router';

import { LocationPicker } from '@/components/common/LocationPicker';
import { ScreenTitle, SectionHeading } from '@/components/common/Primitives';
import { useAppData } from '@/contexts/AppDataContext';
import { useBatchCreation } from '@/contexts/BatchCreationContext';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { WorkflowShell } from './WorkflowShell';
import { BatchStepper } from './BatchStepper';
import { StepActions } from './StepActions';

export function CreateBatchDetails() {
  const { items, updateItem } = useBatchCreation();
  const { refresh } = useAppData();
  const { refreshing, refresh: onRefresh } = usePullRefresh(refresh);

  return (
    <WorkflowShell refreshing={refreshing} onRefresh={onRefresh}>
      <ScreenTitle>Create a Stock Batch</ScreenTitle>
      <BatchStepper active={3} />
      <View className="mt-7">
        <SectionHeading>Enter Details Of Products</SectionHeading>
      </View>

      {items.map((item) => (
        <View key={item.product.id} className="mt-4 overflow-hidden rounded-2xl border border-[#0ba178] bg-canvas">
          <View className="bg-[#0ba178] px-4 py-3">
            <Text className="text-sm font-lexend-semibold text-white">{item.product.grade || item.product.name}</Text>
            <Text className="text-[10px] font-lexend text-white/80">SKU : {item.product.sku}</Text>
          </View>
          <View className="px-4 py-3">
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Text className="text-[10px] font-lexend-semibold text-ink">Manufacturing Date</Text>
                <TextInput
                  value={item.manufacturingDate}
                  onChangeText={(v) => updateItem(item.product.id, { manufacturingDate: v })}
                  placeholder="YYYY-MM-DD"
                  className="mt-1 h-10 rounded-lg border border-[#dfe3ee] bg-[#dfe1e7] px-3 font-lexend text-sm"
                />
              </View>
              <View className="flex-1">
                <Text className="text-[10px] font-lexend-semibold text-ink">Expiry Date</Text>
                <TextInput
                  value={item.expiryDate}
                  onChangeText={(v) => updateItem(item.product.id, { expiryDate: v })}
                  placeholder="YYYY-MM-DD"
                  className="mt-1 h-10 rounded-lg border border-[#dfe3ee] bg-[#dfe1e7] px-3 font-lexend text-sm"
                />
              </View>
            </View>
            <View className="mt-3">
              <Text className="text-[10px] font-lexend-semibold text-ink">Location Stored At</Text>
              <LocationPicker
                value={item.shelfLocationId}
                onSelect={(shelfLocationId, warehouseId) =>
                  updateItem(item.product.id, { shelfLocationId, warehouseId })
                }
              />
            </View>
          </View>
        </View>
      ))}
      {items.length === 0 ? <Text className="mt-6 text-center text-sm text-muted">No products selected.</Text> : null}

      <StepActions
        onPrevious={() => router.push('/batches/create/quantity')}
        onNext={() => router.push('/batches/create/preview')}
        nextDisabled={items.length === 0 || items.some((i) => !i.shelfLocationId)}
      />
    </WorkflowShell>
  );
}
