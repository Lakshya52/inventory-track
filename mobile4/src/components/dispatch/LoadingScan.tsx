import { useCallback, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { QrCode } from 'lucide-react-native';

import { QrScanner } from '@/components/common/QrScanner';
import { TabSwitcher } from '@/components/common/Primitives';
import { useLoading } from '@/contexts/LoadingContext';
import { useAsyncData } from '@/hooks/useAsyncData';
import { domainApi } from '@/services/domain';
import { WorkflowShell } from './WorkflowShell';
import { RecentScansCard, ShipmentDetailsCard } from './LoadingParts';

export function LoadingScan({ complete = false }: { complete?: boolean }) {
  const { activeSession, refresh: refreshSessions } = useLoading();
  const { data, isLoading, isRefreshing, reload, refresh } = useAsyncData(
    () => (activeSession ? domainApi.session(activeSession.id) : Promise.resolve(null)),
    [activeSession?.id],
  );
  const [busy, setBusy] = useState(false);

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([refresh(), refreshSessions()]);
  }, [refresh, refreshSessions]);

  const session = data?.session ?? activeSession;
  const events = data?.events ?? [];
  const scanned = session?.scanned ?? 0;
  const total = session?.total ?? 0;
  const percent = total ? Math.round((scanned / total) * 100) : 0;

  const handleScan = async (qrValue: string) => {
    if (!activeSession || busy || complete) return;
    setBusy(true);
    try {
      const result = await domainApi.scan(activeSession.id, qrValue);
      if (result.result === 'OK') {
        Alert.alert('Scanned', `${result.scanned}/${result.total} units loaded.`);
      } else if (result.result === 'DUPLICATE') {
        Alert.alert('Duplicate QR', 'This QR code was already scanned.');
      } else {
        Alert.alert('Scan rejected', result.error ?? result.result);
      }
      await reload();
      await refreshSessions();
    } catch (cause) {
      Alert.alert('Scan failed', cause instanceof Error ? cause.message : 'Unable to scan QR.');
    } finally {
      setBusy(false);
    }
  };

  if (!activeSession) {
    return (
      <WorkflowShell refreshing={isRefreshing} onRefresh={refreshAll}>
        <TabSwitcher active="scan" onScan={() => {}} onRecall={() => router.push('/loading/recall')} />
        <Text className="mt-8 text-center text-sm text-muted">No active loading session. Start one from the Loading tab.</Text>
      </WorkflowShell>
    );
  }

  return (
    <WorkflowShell refreshing={isRefreshing} onRefresh={refreshAll}>
      <TabSwitcher active="scan" onScan={() => {}} onRecall={() => router.push('/loading/recall')} />
      <Text className="mt-6 text-base font-lexend-semibold text-ink">
        Scanning Order : #{session?.order_number ?? ''}
      </Text>

      <View className="mt-4 rounded-2xl border border-[#e6e9f2] bg-[#f7f8fd] p-4">
        <View className="flex-row items-start justify-between">
          <View>
            <Text className="text-[10px] font-lexend-semibold text-muted">SCANNED UNITS</Text>
            <Text className="mt-1 text-xl font-lexend-bold text-ink">{`${scanned} / ${total}`}</Text>
          </View>
          <Text className="text-lg font-lexend-bold text-brand">{percent}%</Text>
        </View>
        <View className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#dfe3ee]">
          <View className="h-full rounded-full bg-[#0ba178]" style={{ width: `${percent}%` }} />
        </View>
        <View className="mt-2 flex-row justify-between">
          <Text className="text-[10px] font-lexend text-muted">{total - scanned} units remaining</Text>
          <Text className="text-[10px] font-lexend text-muted">Live</Text>
        </View>
      </View>

      {complete || busy ? null : <QrScanner onScan={handleScan} label="Enter QR value to scan" />}
      {isLoading ? <ActivityIndicator className="mt-4" color="#0b218c" /> : null}

      <Pressable
        onPress={complete ? () => router.push('/loading/seal') : () => router.push('/loading/complete')}
        className={`mt-5 h-12 items-center justify-center rounded-xl ${complete ? 'bg-[#0ba178]' : 'bg-[#d33b4a]'}`}>
        <Text className="text-base font-lexend-semibold text-white">
          {complete ? 'Seal & Finalize' : 'Stop Scanning'}
        </Text>
      </Pressable>

      {complete ? null : (
        <View className="mt-4 min-h-36 rounded-2xl border border-[#e6e9f2] bg-canvas p-4">
          <View className="flex-row items-center gap-2">
            <QrCode size={16} color="#6d5ae0" />
            <Text className="text-sm font-lexend-semibold text-ink">Products To Scan</Text>
          </View>
          {(session?.order_lines ?? []).map((line, index) => (
            <Text key={index} className="mt-2 text-xs font-lexend text-muted">
              {String(line.batch_number ?? line.batch_id)} × {line.quantity}
            </Text>
          ))}
        </View>
      )}

      <ShipmentDetailsCard session={session} />
      <RecentScansCard events={events} />
    </WorkflowShell>
  );
}
