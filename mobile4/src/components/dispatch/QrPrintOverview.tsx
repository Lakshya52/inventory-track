import { useMemo, useState } from 'react';
import { View, Text, TextInput, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';

import { AppHeader } from '@/components/layout/AppHeader';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { ScreenSubtitle, ScreenTitle, SectionHeading } from '@/components/common/Primitives';
import { useAsyncData } from '@/hooks/useAsyncData';
import { domainApi } from '@/services/domain';
import type { QcStatus } from './BatchQrDetails';
import { BatchCard } from './BatchCard';

function statusOf(job: {
  batch_status?: string;
  printed_count?: number;
  label_count?: number;
}): QcStatus {
  if (job.batch_status === 'QC_FAILED' || job.batch_status === 'REJECTED') return 'FAILED';
  if (job.batch_status === 'PENDING_QC') return 'NOT_MARKED';
  if ((job.printed_count ?? 0) > 0 && (job.printed_count ?? 0) >= (job.label_count ?? 0)) return 'PRINTED';
  return 'PASS';
}

export function QrPrintOverview() {
  const { data, isLoading, isRefreshing, error, reload, refresh } = useAsyncData(domainApi.qrJobs);
  const [query, setQuery] = useState('');

  const jobs = useMemo(() => {
    const all = data?.items ?? [];
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter(
      (job) =>
        String(job.batch_number ?? '').toLowerCase().includes(q) ||
        String(job.job_code ?? '').toLowerCase().includes(q) ||
        String(job.product_name ?? '').toLowerCase().includes(q),
    );
  }, [data, query]);

  return (
    <>
      <AppHeader title="QR Codes / Labels" />
      <ScreenContainer edges={[]} scroll refreshing={isRefreshing} onRefresh={refresh}>
        <View className="px-5 pt-6">
          <ScreenTitle>QR Codes / Labels</ScreenTitle>
          <ScreenSubtitle>Choose products, set quantities and print your QR labels.</ScreenSubtitle>

          <View className="mt-8">
            <SectionHeading>Select a Batch</SectionHeading>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search Created Batches"
            className="mt-3 h-12 rounded-xl bg-[#eef1f7] px-4 font-lexend text-ink"
          />

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
              {jobs.map((job) => (
                <BatchCard
                  key={job.id}
                  id={String(job.batch_number ?? job.job_code)}
                  products={String(job.product_name ?? 'Product')}
                  meta={`${job.quantity ?? 0} units · ${String(job.created_at ?? '').slice(0, 10)}`}
                  count={`${job.label_count ?? job.quantity ?? 0} labels`}
                  actionLabel="View QRs"
                  onAction={() => router.push(`/qr-print/${job.id}?status=${statusOf(job)}`)}
                />
              ))}
              {jobs.length === 0 ? <Text className="text-center text-sm text-muted">No QR jobs found.</Text> : null}
            </View>
          )}

          <View className="h-28" />
        </View>
      </ScreenContainer>
    </>
  );
}
