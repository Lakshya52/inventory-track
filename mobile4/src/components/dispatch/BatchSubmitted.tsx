import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { CircleCheck } from 'lucide-react-native';

import { WorkflowShell } from './WorkflowShell';
import { useAppData } from '@/contexts/AppDataContext';
import { useBatchCreation } from '@/contexts/BatchCreationContext';

export function BatchSubmitted() {
  const { lastCreated, reset } = useBatchCreation();
  const { products } = useAppData();
  const batches = lastCreated?.batches ?? [];

  const gradeOf = (batch: { product_sku?: string; product_name?: string }) =>
    products.find(
      (product) =>
        String(product.sku) === String(batch.product_sku) ||
        String(product.name) === String(batch.product_name),
    )?.grade;

  return (
    <WorkflowShell>
      <View className="mt-10 items-center">
        <View className="h-20 w-20 items-center justify-center rounded-full bg-[#d9f3e8]">
          <CircleCheck size={44} color="#0ba178" />
        </View>
        <Text className="mt-5 text-2xl font-lexend-bold text-brand">Batch created!</Text>
        <Text className="mt-2 text-center text-sm font-lexend text-muted">
          Your stock batch has been submitted. All {lastCreated?.product_count ?? 0} products are included.
        </Text>
        <Text className="mt-4 text-base font-lexend-semibold text-brand">
          {lastCreated?.batch_number ?? 'BATCH'}
        </Text>
      </View>

      <View className="mt-7 overflow-hidden rounded-2xl border border-[#e6e9f2] bg-canvas">
        <View className="border-b border-[#e6e9f2] bg-[#f7f8fd] px-4 py-3">
          <Text className="text-xs font-lexend-semibold text-ink">Products In This Batch</Text>
        </View>
        {batches.map((batch, index) => (
          <View key={index} className="border-b border-[#e6e9f2] px-4 py-3 last:border-b-0">
            <View className="flex-row items-center gap-2">
              <Text className="text-sm font-lexend-semibold text-brand">
                {gradeOf(batch) || String(batch.product_name ?? '')}
              </Text>
              <View className="rounded bg-[#0ba178] px-1.5 py-0.5">
                <Text className="text-[8px] font-lexend-semibold text-white">
                  {String(batch.product_name ?? '')}
                </Text>
              </View>
            </View>
            <Text className="mt-1 text-[10px] font-lexend text-muted">
              {String(batch.quantity ?? 0)} × {String(batch.package_quantity ?? 0)} {String(batch.uom ?? '')}
            </Text>
            <Text className="text-[10px] font-lexend text-muted">{String(batch.product_sku ?? '')}</Text>
            <Text className="text-[10px] font-lexend text-muted">{String(batch.location_code ?? '')}</Text>
          </View>
        ))}
      </View>

      <View className="mt-6 gap-3">
        <Pressable onPress={() => router.push('/qr-print')} className="h-12 items-center justify-center rounded-xl bg-brand">
          <Text className="text-base font-lexend-semibold text-white">View Batch</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            reset();
            router.push('/batches/create/select');
          }}
          className="h-12 items-center justify-center rounded-xl border border-brand">
          <Text className="text-base font-lexend-semibold text-brand">Create Another Batch</Text>
        </Pressable>
      </View>
    </WorkflowShell>
  );
}
