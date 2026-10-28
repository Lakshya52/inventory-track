import { Check, X } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { PageHeading } from '@/components/ui/page';
import { Screen } from '@/components/ui/screen';
import { StatusBadge } from '@/components/ui/status-badge';
import { qcBatchQueue } from '@/data/mock';

type BatchStatus = 'pending' | 'passed' | 'failed';

type Batch = {
  id: string;
  batch: string;
  product: string;
  quantity: string;
  vendor: string;
  status: BatchStatus;
};

export function BatchesScreen() {
  const [batches, setBatches] = useState<Batch[]>(
    qcBatchQueue.map((batch) => ({ ...batch, status: batch.status as BatchStatus })),
  );

  const mark = (id: string, status: BatchStatus) => {
    setBatches((current) =>
      current.map((batch) => (batch.id === id ? { ...batch, status } : batch)),
    );
  };

  return (
    <Screen>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}>
        <View className="px-5 pt-6">
          <PageHeading title="Batches" subtitle="Quality control queue for today" />

          <View className="mt-5 gap-3">
            {batches.map((batch) => {
              const badge =
                batch.status === 'passed'
                  ? { status: 'passed' as const, label: 'QC Passed' }
                  : batch.status === 'failed'
                    ? { status: 'failed' as const, label: 'QC Failed' }
                    : { status: 'pending' as const, label: 'Pending' };

              return (
                <View
                  key={batch.id}
                  className="rounded-[12px] border border-[#D4E3FA] bg-white px-4 py-4">
                  <View className="flex-row items-start justify-between">
                    <View className="flex-1 pr-3">
                      <AppText
                        className="text-[12px] text-navy"
                        style={{ fontFamily: 'Manrope_700Bold' }}>
                        Batch : {batch.batch}
                      </AppText>
                      <AppText variant="caption" className="mt-1">
                        {batch.product} · {batch.quantity}
                      </AppText>
                      <AppText variant="caption" className="mt-0.5">
                        {batch.vendor}
                      </AppText>
                    </View>
                    <StatusBadge status={badge.status} label={badge.label} />
                  </View>

                  {batch.status === 'pending' ? (
                    <View className="mt-3 flex-row gap-2">
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => mark(batch.id, 'failed')}
                        className="h-9 flex-1 flex-row items-center justify-center gap-1 rounded-[8px] border border-[#F3AAB2] bg-[#FFF8F9]"
                        style={({ pressed }) => (pressed ? { opacity: 0.75 } : undefined)}>
                        <X size={14} color="#DD4350" strokeWidth={2.2} />
                        <AppText
                          className="text-[11px] text-danger-text"
                          style={{ fontFamily: 'Manrope_700Bold' }}>
                          Mark Failed
                        </AppText>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => mark(batch.id, 'passed')}
                        className="h-9 flex-1 flex-row items-center justify-center gap-1 rounded-[8px] bg-navy"
                        style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}>
                        <Check size={14} color="#FFFFFF" strokeWidth={2.4} />
                        <AppText
                          className="text-[11px] text-white"
                          style={{ fontFamily: 'Manrope_700Bold' }}>
                          Mark Passed
                        </AppText>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
