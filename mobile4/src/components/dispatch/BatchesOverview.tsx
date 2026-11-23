import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Plus } from 'lucide-react-native';

import { AppHeader } from '@/components/layout/AppHeader';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { KpiCard } from '@/components/common/KpiCard';
import { ScreenSubtitle, ScreenTitle, SectionHeading } from '@/components/common/Primitives';
import { useAsyncData } from '@/hooks/useAsyncData';
import { domainApi } from '@/services/domain';
import { BatchCard } from './BatchCard';

export function BatchesOverview() {
  const { data, isLoading, isRefreshing, error, reload, refresh } = useAsyncData(domainApi.batchGroups);
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const all = data?.items ?? [];
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter((group) => {
      const children = (group.batches as Array<Record<string, unknown>>) ?? [];
      return (
        String(group.batch_number ?? '').toLowerCase().includes(q) ||
        children.some((child) =>
          [child.product_name, child.grade_name, child.product_sku]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(q),
        )
      );
    });
  }, [data, query]);

  const totalBatches = data?.total ?? 0;
  const totalUnits = (data?.items ?? []).reduce((sum, g) => sum + Number(g.total_quantity ?? 0), 0);
  const totalGrades = new Set(
    (data?.items ?? []).flatMap((g) =>
      ((g.batches as Array<Record<string, unknown>>) ?? []).map((b) => String(b.product_id ?? '')),
    ),
  ).size;

  return (
    <>
      <AppHeader title="Batches" />
      <ScreenContainer edges={[]} scroll refreshing={isRefreshing} onRefresh={refresh}>
        <View className="px-5 pt-6">
          <ScreenTitle>{'Manage Product\nBatches'}</ScreenTitle>
          <ScreenSubtitle>Group multiple products in a single batch.</ScreenSubtitle>

          <View className="mt-8">
            <SectionHeading>Quick KPIs / Overview</SectionHeading>
          </View>
          <View className="mt-3 flex-row gap-3">
            <KpiCard value={String(totalBatches)} label="Total batches" />
            <KpiCard value={String(totalGrades)} label="Total grades" />
            <KpiCard value={String(totalUnits)} label="Total units" highlight />
          </View>

          <Pressable
            onPress={() => router.push('/batches/create/select')}
            className="mt-6 h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-[#0ba178]">
            <Plus size={20} color="#ffffff" />
            <Text className="text-base font-lexend-semibold text-white">Create new batch</Text>
          </Pressable>

          <View className="mt-8">
            <SectionHeading>Recent batches</SectionHeading>
          </View>
          <View className="mt-3">
            <TextInputSearch value={query} onChange={setQuery} />
          </View>

          {isLoading ? (
            <View className="mt-6 items-center">
              <ActivityIndicator color="#0b218c" />
            </View>
          ) : error ? (
            <Text className="mt-6 text-center text-sm text-red-600" onPress={reload}>
              {error}
            </Text>
          ) : (
            <View className="mt-4 gap-3">
              {groups.map((group) => {
                const children = (group.batches as Array<Record<string, unknown>>) ?? [];
                const products = children.map((c) => `${c.product_name ?? ''} - ${c.quantity ?? 0} units`).join('\n');
                return (
                  <BatchCard
                    key={String(group.group_key)}
                    id={String(group.batch_number ?? '')}
                    products={products || 'Batch'}
                    meta={`${group.total_quantity ?? 0} units · ${String(group.created_at ?? '').slice(0, 10)}`}
                    count={`${group.product_count ?? 0} products`}
                    actionLabel="View batch"
                    onAction={() => router.push('/qr-print')}
                  />
                );
              })}
              {groups.length === 0 ? <Text className="text-center text-sm text-muted">No batches found.</Text> : null}
            </View>
          )}

          <View className="h-28" />
        </View>
      </ScreenContainer>
    </>
  );
}

function TextInputSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="Search batch ID or product"
      className="h-10 rounded-xl border border-[#dfe3ee] px-4 font-lexend text-sm text-ink"
    />
  );
}
