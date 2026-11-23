import { View, Text, TextInput } from 'react-native';
import { router } from 'expo-router';

import { ScreenTitle, SectionHeading } from '@/components/common/Primitives';
import { useAppData } from '@/contexts/AppDataContext';
import { useBatchCreation } from '@/contexts/BatchCreationContext';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { WorkflowShell } from './WorkflowShell';
import { BatchStepper } from './BatchStepper';
import { StepActions } from './StepActions';

function NumberField({
  label,
  value,
  onChange,
  unit,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit: string;
}) {
  return (
    <View className="flex-1">
      <Text className="text-[10px] font-lexend-semibold text-ink">{label}</Text>
      <View className="mt-1 h-10 flex-row items-center rounded-lg border border-[#dfe3ee] bg-[#f1f2f8] px-3">
        <TextInput
          value={String(value)}
          onChangeText={(text) => onChange(Math.max(0, Number(text) || 0))}
          keyboardType="numeric"
          className="flex-1 font-lexend text-sm text-ink"
        />
        <Text className="text-xs font-lexend text-muted">{unit}</Text>
      </View>
    </View>
  );
}

export function CreateBatchQuantity() {
  const { items, updateItem } = useBatchCreation();
  const { refresh } = useAppData();
  const { refreshing, refresh: onRefresh } = usePullRefresh(refresh);

  return (
    <WorkflowShell refreshing={refreshing} onRefresh={onRefresh}>
      <ScreenTitle>Create a Stock Batch</ScreenTitle>
      <BatchStepper active={2} />
      <View className="mt-7">
        <SectionHeading>Select Quantity</SectionHeading>
      </View>

      {items.map((item) => {
        const total = item.quantity * item.packageQuantity;
        return (
          <View key={item.product.id} className="mt-4 overflow-hidden rounded-2xl border border-[#0ba178] bg-canvas">
            <View className="flex-row items-center justify-between bg-[#0ba178] px-4 py-3">
              <View>
                <Text className="text-sm font-lexend-semibold text-white">{item.product.grade || item.product.name}</Text>
                <Text className="text-[10px] font-lexend text-white/80">SKU : {item.product.sku}</Text>
              </View>
              <View className="rounded-full bg-white/20 px-2 py-0.5">
                <Text className="text-[8px] font-lexend-semibold text-white">{item.product.name}</Text>
              </View>
            </View>
            <View className="px-4 py-3">
              <View className="flex-row gap-3">
                <NumberField
                  label="Package Size"
                  value={item.packageQuantity}
                  onChange={(v) => updateItem(item.product.id, { packageQuantity: v })}
                  unit="Kg"
                />
                <NumberField
                  label="Average Quantity"
                  value={item.avgStandardQuantity}
                  onChange={(v) => updateItem(item.product.id, { avgStandardQuantity: v })}
                  unit="Kg"
                />
              </View>
              <View className="mt-4 flex-row gap-3">
                <NumberField
                  label="Number of Packages"
                  value={item.quantity}
                  onChange={(v) => updateItem(item.product.id, { quantity: v })}
                  unit="Bags"
                />
                <View className="flex-1 justify-center rounded-lg bg-[#d9f3e8] px-3 py-2">
                  <Text className="text-[9px] font-lexend-semibold text-[#0b8c6f]">TOTAL MATERIAL QUANTITY</Text>
                  <Text className="mt-1 text-lg font-lexend-bold text-brand">{total} Kg</Text>
                  <Text className="text-[9px] font-lexend text-muted">{`${item.quantity} bags × ${item.packageQuantity} Kg per bag`}</Text>
                </View>
              </View>
              <Text className="mt-3 text-[10px] font-lexend text-muted">
                {item.quantity} QR Labels Will Be Reserved For This Line.
              </Text>
            </View>
          </View>
        );
      })}
      {items.length === 0 ? <Text className="mt-6 text-center text-sm text-muted">No products selected.</Text> : null}

      <StepActions
        onPrevious={() => router.push('/batches/create/select')}
        onNext={() => router.push('/batches/create/details')}
        nextDisabled={items.length === 0}
      />
    </WorkflowShell>
  );
}
