import { useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { Printer } from 'lucide-react-native';

import { ScreenSubtitle, ScreenTitle } from '@/components/common/Primitives';
import { useAsyncData } from '@/hooks/useAsyncData';
import { domainApi } from '@/services/domain';
import { WorkflowShell } from './WorkflowShell';

export type QcStatus = 'NOT_MARKED' | 'PASS' | 'PRINTED' | 'FAILED';

const CONFIG: Record<QcStatus, { status: string; banner: string; bg: string; mood: 'neutral' | 'happy' | 'sad' }> = {
  NOT_MARKED: {
    status: 'Status : QC not marked yet. You can not print now, wait for QC clearance',
    banner: 'QC Not Marked',
    bg: 'bg-[#e5c36a]',
    mood: 'neutral',
  },
  PASS: {
    status: 'Status : QC passed you can now print all QR codes present in this batch',
    banner: 'QC Passed',
    bg: 'bg-[#8ed8bd]',
    mood: 'happy',
  },
  PRINTED: {
    status: 'Status : All QR codes printed you can raise a re-print request below',
    banner: 'QC Passed',
    bg: 'bg-[#8ed8bd]',
    mood: 'happy',
  },
  FAILED: {
    status: 'Status : QC not passed you can not print.',
    banner: 'QC Failed',
    bg: 'bg-[#f3a6a6]',
    mood: 'sad',
  },
};

function FaceIcon({ mood }: { mood: 'neutral' | 'happy' | 'sad' }) {
  const color = mood === 'sad' ? '#b4232f' : mood === 'happy' ? '#0b6e56' : '#8a6a16';
  const mouthStyle =
    mood === 'happy'
      ? { borderBottomWidth: 2, borderBottomColor: color, borderRadius: 12 }
      : mood === 'sad'
        ? { borderTopWidth: 2, borderTopColor: color, borderRadius: 12 }
        : { borderBottomWidth: 2, borderBottomColor: color };
  return (
    <View className="h-16 w-16 items-center justify-center rounded-full border-2" style={{ borderColor: color }}>
      <View className="flex-row gap-3">
        <View className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <View className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      </View>
      <View className="mt-1 h-3 w-6" style={mouthStyle} />
    </View>
  );
}

export function BatchQrDetails({ jobId, status = 'PASS' }: { jobId: string; status?: QcStatus }) {
  const { data, isLoading, isRefreshing, error, reload, refresh } = useAsyncData(() => domainApi.qrJob(jobId), [jobId]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const config = CONFIG[status];
  const canPrint = status === 'PASS';
  const isPrinted = status === 'PRINTED';
  const labels = (data?.labels ?? []).filter((label) => {
    if (!query.trim()) return true;
    return String(label.qr_value ?? '').toLowerCase().includes(query.toLowerCase());
  });

  const printAll = async () => {
    setBusy(true);
    try {
      const result = await domainApi.printQrJob(jobId);
      await domainApi.printResult([jobId], 'PRINTED');
      Alert.alert('Print job sent', `${result.selected_count ?? 0} label(s) sent to the print queue.`);
      await reload();
    } catch (cause) {
      Alert.alert('Print failed', cause instanceof Error ? cause.message : 'Unable to print labels.');
    } finally {
      setBusy(false);
    }
  };

  const reprint = async (labelId: string | number) => {
    try {
      await domainApi.reprintLabels(jobId, [labelId]);
      Alert.alert('Reprint requested', 'The label was sent to the print queue.');
      await reload();
    } catch (cause) {
      Alert.alert('Reprint failed', cause instanceof Error ? cause.message : 'Unable to reprint label.');
    }
  };

  return (
    <WorkflowShell refreshing={isRefreshing} onRefresh={refresh}>
      <ScreenTitle>Batch QR Details</ScreenTitle>
      <ScreenSubtitle>Print QR codes and view details of your generated batches</ScreenSubtitle>

      <Text className="mt-6 text-sm font-lexend-semibold leading-5 text-brand">{config.status}</Text>

      <View className={`mt-5 items-center rounded-2xl px-4 py-7 ${config.bg}`}>
        <FaceIcon mood={config.mood} />
        <Text className="mt-2 text-base font-lexend-semibold text-brand">{config.banner}</Text>
        <Text className="mt-1 text-sm font-lexend-semibold text-brand">
          Selected Batch : #{String(data?.job?.batch_number ?? '')}
        </Text>
      </View>

      {canPrint ? (
        <Pressable
          onPress={printAll}
          disabled={busy}
          className="mt-5 h-12 flex-row items-center justify-center gap-2 rounded-xl bg-[#0ba178]">
          {busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <>
              <Printer size={18} color="#ffffff" />
              <Text className="text-base font-lexend-semibold text-white">Send To Print</Text>
            </>
          )}
        </Pressable>
      ) : null}

      <View className="mt-6">
        {status !== 'NOT_MARKED' ? (
          <Text className="mb-3 text-sm font-lexend-semibold text-brand">Search QR Codes</Text>
        ) : null}
        <View className="flex-row items-center gap-2">
          <View className="flex-1">
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search Serial Number"
              className="h-12 rounded-xl bg-[#eef1f7] px-4 font-lexend text-ink"
            />
          </View>
          <View className="h-12 w-12 items-center justify-center rounded-xl bg-[#7b86c4]">
            <Printer size={18} color="#ffffff" />
          </View>
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator className="mt-6" color="#0b218c" />
      ) : error ? (
        <Text className="mt-6 text-center text-sm text-red-600" onPress={reload}>
          {error}
        </Text>
      ) : (
        <View className="mt-4 rounded-2xl border border-[#e6e9f2] bg-canvas px-4">
          {labels.map((label) => (
            <View key={label.id} className="flex-row items-center border-b border-[#e6e9f2] py-3 last:border-b-0">
              <View className="flex-1">
                <Text className="text-[10px] font-lexend text-muted">
                  {String(label.last_printed_at ?? '').slice(0, 16).replace('T', ' - ')}
                </Text>
                <Text className="mt-1 text-sm font-lexend-semibold text-ink">{label.qr_value}</Text>
                <Text className="mt-1 text-[11px] font-lexend text-muted">
                  {label.product_sku ?? ''} {label.status ? `· ${label.status}` : ''}
                </Text>
              </View>
              {isPrinted ? (
                <Pressable
                  onPress={() => reprint(label.id)}
                  className="ml-3 h-10 w-10 items-center justify-center rounded-full bg-[#0ba178]">
                  <Printer size={18} color="#ffffff" />
                </Pressable>
              ) : null}
            </View>
          ))}
          {labels.length === 0 ? <Text className="py-6 text-center text-sm text-muted">No QR codes found.</Text> : null}
        </View>
      )}
    </WorkflowShell>
  );
}
